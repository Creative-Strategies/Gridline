use crate::model::{CellCoord, CellStyle, CellValue, Workbook, Worksheet, parse_address};
use std::collections::HashSet;

const MAX_TOKENS: usize = 4_096;
const MAX_RANGE_CELLS: u64 = 100_000;
const MAX_EXPANDED_VALUES_PER_FORMULA: usize = 100_000;
const MAX_EXPANDED_VALUES_PER_WORKBOOK: usize = 1_000_000;
const MAX_FUNCTION_ARGUMENTS: usize = 256;
const MAX_PARSE_DEPTH: usize = 256;
const MAX_REFERENCE_DEPTH: usize = 256;
const MAX_EVALUATION_STEPS: usize = 250_000;
const MAX_RECALC_PASSES: usize = 8;

#[derive(Debug, Clone, PartialEq)]
struct CellReference {
    sheet: Option<String>,
    coord: CellCoord,
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Text(String),
    Reference(CellReference),
    Identifier(String),
    Plus,
    Minus,
    Star,
    Slash,
    Colon,
    Comma,
    LeftParen,
    RightParen,
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
}

#[derive(Debug, Clone, PartialEq)]
enum Scalar {
    Blank,
    Number(f64),
    Text(String),
    Boolean(bool),
    Error(String),
}

impl Scalar {
    fn as_number(&self) -> Option<f64> {
        match self {
            Self::Number(value) => Some(*value),
            Self::Boolean(value) => Some(if *value { 1.0 } else { 0.0 }),
            Self::Text(value) => value.parse().ok(),
            Self::Blank | Self::Error(_) => None,
        }
    }

    fn is_blank(&self) -> bool {
        matches!(self, Self::Blank) || matches!(self, Self::Text(value) if value.is_empty())
    }

    fn truthy(&self) -> bool {
        match self {
            Self::Boolean(value) => *value,
            Self::Number(value) => value.abs() >= f64::EPSILON,
            Self::Text(value) => !value.is_empty(),
            Self::Blank | Self::Error(_) => false,
        }
    }

    fn into_cell_value(self) -> CellValue {
        match self {
            Self::Blank => CellValue::Blank,
            Self::Number(value) => CellValue::Number(value),
            Self::Text(value) => CellValue::String(value),
            Self::Boolean(value) => CellValue::Boolean(value),
            Self::Error(value) => CellValue::Error(value),
        }
    }
}

impl From<&CellValue> for Scalar {
    fn from(value: &CellValue) -> Self {
        match value {
            CellValue::Blank => Self::Blank,
            CellValue::String(value) => Self::Text(value.clone()),
            CellValue::Number(value) => Self::Number(*value),
            CellValue::Boolean(value) => Self::Boolean(*value),
            CellValue::Error(value) => Self::Error(value.clone()),
        }
    }
}

#[derive(Debug, Clone)]
enum Argument {
    Value(Scalar),
    Range(CellReference, CellReference),
}

/// Evaluate a formula against one worksheet.
#[allow(dead_code)]
pub fn evaluate_formula(sheet: &Worksheet, formula: &str) -> Option<f64> {
    let workbook = Workbook {
        title: String::new(),
        sheets: vec![sheet.clone()],
        styles: vec![CellStyle::default()],
        date_1904: false,
    };
    evaluate_formula_value_in_workbook(&workbook, 0, formula)?.as_number()
}

/// Evaluate a formula with references resolved against the complete workbook.
#[allow(dead_code)]
pub fn evaluate_formula_in_workbook(
    workbook: &Workbook,
    sheet_index: usize,
    formula: &str,
) -> Option<f64> {
    evaluate_formula_value_in_workbook(workbook, sheet_index, formula)?.as_number()
}

fn evaluate_formula_value_in_workbook(
    workbook: &Workbook,
    sheet_index: usize,
    formula: &str,
) -> Option<Scalar> {
    let mut budget = EvaluationBudget::default();
    evaluate_formula_value_in_workbook_with_budget(workbook, sheet_index, formula, &mut budget)
}

fn evaluate_formula_value_in_workbook_with_budget(
    workbook: &Workbook,
    sheet_index: usize,
    formula: &str,
    budget: &mut EvaluationBudget,
) -> Option<Scalar> {
    if sheet_index >= workbook.sheets.len() {
        return None;
    }
    let mut context = EvalContext {
        workbook,
        visiting: HashSet::new(),
        budget,
    };
    context.evaluate_formula(sheet_index, formula)
}

/// Fill blank formula cells in a single worksheet. The workbook pass below
/// is what resolves cross-sheet dependencies after all sheets are parsed.
pub fn evaluate_missing_formulas(sheet: &mut Worksheet) {
    let mut budget = EvaluationBudget::default();
    for _ in 0..MAX_RECALC_PASSES.min(4) {
        let pending = sheet
            .cells
            .iter()
            .filter_map(|(coord, cell)| {
                matches!(cell.value, CellValue::Blank)
                    .then(|| cell.formula.clone().map(|formula| (*coord, formula)))
                    .flatten()
            })
            .collect::<Vec<_>>();
        if pending.is_empty() {
            break;
        }
        let snapshot = Workbook {
            title: String::new(),
            sheets: vec![sheet.clone()],
            styles: vec![CellStyle::default()],
            date_1904: false,
        };
        let updates = pending
            .into_iter()
            .filter_map(|(coord, formula)| {
                evaluate_formula_value_in_workbook_with_budget(&snapshot, 0, &formula, &mut budget)
                    .map(|value| (coord, value.into_cell_value()))
            })
            .collect::<Vec<_>>();
        if updates.is_empty() {
            break;
        }
        for (coord, value) in updates {
            if let Some(cell) = sheet.cells.get_mut(&coord) {
                cell.value = value;
            }
        }
    }
}

/// Recalculate blank formula cells after all worksheets have been parsed.
/// Cached XLSX values are preserved; this fills only missing cached results.
pub fn evaluate_missing_formulas_in_workbook(workbook: &mut Workbook) {
    let mut budget = EvaluationBudget::default();
    for _ in 0..MAX_RECALC_PASSES {
        let snapshot = workbook.clone();
        let pending = snapshot
            .sheets
            .iter()
            .enumerate()
            .flat_map(|(sheet_index, sheet)| {
                sheet.cells.iter().filter_map(move |(coord, cell)| {
                    matches!(cell.value, CellValue::Blank)
                        .then(|| {
                            cell.formula
                                .clone()
                                .map(|formula| (sheet_index, *coord, formula))
                        })
                        .flatten()
                })
            })
            .collect::<Vec<_>>();
        if pending.is_empty() {
            break;
        }
        let updates = pending
            .into_iter()
            .filter_map(|(sheet_index, coord, formula)| {
                evaluate_formula_value_in_workbook_with_budget(
                    &snapshot,
                    sheet_index,
                    &formula,
                    &mut budget,
                )
                .map(|value| (sheet_index, coord, value.into_cell_value()))
            })
            .collect::<Vec<_>>();
        if updates.is_empty() {
            break;
        }
        for (sheet_index, coord, value) in updates {
            if let Some(cell) = workbook
                .sheets
                .get_mut(sheet_index)
                .and_then(|sheet| sheet.cells.get_mut(&coord))
            {
                cell.value = value;
            }
        }
    }
}

#[derive(Default)]
struct EvaluationBudget {
    steps: usize,
    reference_depth: usize,
    expanded_values: usize,
}

impl EvaluationBudget {
    fn consume_step(&mut self) -> bool {
        if self.steps >= MAX_EVALUATION_STEPS {
            return false;
        }
        self.steps += 1;
        true
    }

    fn enter_reference(&mut self) -> bool {
        if self.reference_depth >= MAX_REFERENCE_DEPTH {
            return false;
        }
        self.reference_depth += 1;
        true
    }

    fn leave_reference(&mut self) {
        self.reference_depth = self.reference_depth.saturating_sub(1);
    }

    fn consume_expanded_values(&mut self, count: usize) -> bool {
        let Some(total) = self.expanded_values.checked_add(count) else {
            return false;
        };
        if total > MAX_EXPANDED_VALUES_PER_WORKBOOK {
            return false;
        }
        self.expanded_values = total;
        true
    }
}

struct EvalContext<'workbook, 'budget> {
    workbook: &'workbook Workbook,
    visiting: HashSet<(usize, u32, u32)>,
    budget: &'budget mut EvaluationBudget,
}

impl EvalContext<'_, '_> {
    fn evaluate_formula(&mut self, sheet_index: usize, formula: &str) -> Option<Scalar> {
        if !self.budget.consume_step() {
            return None;
        }
        let tokens = tokenize(formula.strip_prefix('=').unwrap_or(formula))?;
        let mut parser = Parser {
            context: self,
            sheet_index,
            tokens,
            cursor: 0,
            parse_depth: 0,
            expansion_budget: MAX_EXPANDED_VALUES_PER_FORMULA,
        };
        let result = parser.expression()?;
        (parser.cursor == parser.tokens.len()).then_some(result)
    }

    fn evaluate_cell_formula(
        &mut self,
        sheet_index: usize,
        coord: CellCoord,
        formula: &str,
    ) -> Option<Scalar> {
        let key = (sheet_index, coord.row, coord.column);
        if self.visiting.contains(&key) || !self.budget.enter_reference() {
            return None;
        }
        self.visiting.insert(key);
        let result = self.evaluate_formula(sheet_index, formula);
        self.visiting.remove(&key);
        self.budget.leave_reference();
        result
    }

    fn sheet_index(&self, current_sheet: usize, name: Option<&str>) -> Option<usize> {
        match name {
            None => Some(current_sheet),
            Some(name) => self
                .workbook
                .sheets
                .iter()
                .position(|sheet| sheet.name.eq_ignore_ascii_case(name)),
        }
    }

    fn value_for_reference(
        &mut self,
        current_sheet: usize,
        reference: &CellReference,
    ) -> Option<Scalar> {
        let sheet_index = self.sheet_index(current_sheet, reference.sheet.as_deref())?;
        let Some(cell) = self
            .workbook
            .sheets
            .get(sheet_index)
            .and_then(|sheet| sheet.cell(reference.coord))
        else {
            return Some(Scalar::Blank);
        };
        let value = Scalar::from(&cell.value);
        if !matches!(value, Scalar::Blank) {
            return Some(value);
        }
        let formula = cell.formula.clone()?;
        self.evaluate_cell_formula(sheet_index, reference.coord, &formula)
    }
}

struct Parser<'context, 'workbook, 'budget> {
    context: &'context mut EvalContext<'workbook, 'budget>,
    sheet_index: usize,
    tokens: Vec<Token>,
    cursor: usize,
    parse_depth: usize,
    expansion_budget: usize,
}

#[derive(Clone, Copy)]
enum Comparison {
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
}

impl Parser<'_, '_, '_> {
    fn expression(&mut self) -> Option<Scalar> {
        let mut value = self.additive()?;
        let comparison = match self.peek() {
            Some(Token::Equal) => Some(Comparison::Equal),
            Some(Token::NotEqual) => Some(Comparison::NotEqual),
            Some(Token::Less) => Some(Comparison::Less),
            Some(Token::LessEqual) => Some(Comparison::LessEqual),
            Some(Token::Greater) => Some(Comparison::Greater),
            Some(Token::GreaterEqual) => Some(Comparison::GreaterEqual),
            _ => None,
        };
        if let Some(compare) = comparison {
            self.cursor += 1;
            let right = self.additive()?;
            let order = scalar_compare(&value, &right);
            value = Scalar::Boolean(match compare {
                Comparison::Equal => order == 0,
                Comparison::NotEqual => order != 0,
                Comparison::Less => order < 0,
                Comparison::LessEqual => order <= 0,
                Comparison::Greater => order > 0,
                Comparison::GreaterEqual => order >= 0,
            });
        }
        Some(value)
    }

    fn additive(&mut self) -> Option<Scalar> {
        let mut value = self.term()?;
        loop {
            let add = match self.peek() {
                Some(Token::Plus) => Some(true),
                Some(Token::Minus) => Some(false),
                _ => None,
            };
            let Some(add) = add else { return Some(value) };
            self.cursor += 1;
            let right = self.term()?;
            value = numeric_binary(
                &value,
                &right,
                if add { |a, b| a + b } else { |a, b| a - b },
            )?;
        }
    }

    fn term(&mut self) -> Option<Scalar> {
        let mut value = self.unary()?;
        loop {
            let multiply = match self.peek() {
                Some(Token::Star) => Some(true),
                Some(Token::Slash) => Some(false),
                _ => None,
            };
            let Some(multiply) = multiply else {
                return Some(value);
            };
            self.cursor += 1;
            let right = self.unary()?;
            if !multiply && arithmetic_number(&right)?.abs() < f64::EPSILON {
                return None;
            }
            value = numeric_binary(
                &value,
                &right,
                if multiply { |a, b| a * b } else { |a, b| a / b },
            )?;
        }
    }

    fn unary(&mut self) -> Option<Scalar> {
        // Some producer-generated Atlas formulas contain a redundant equals
        // after an operator, e.g. `B6*='Assumptions'!$K$32`.
        while matches!(self.peek(), Some(Token::Equal)) {
            self.cursor += 1;
        }
        match self.peek() {
            Some(Token::Plus) => {
                self.cursor += 1;
                self.recurse(|parser| parser.unary())
            }
            Some(Token::Minus) => {
                self.cursor += 1;
                self.recurse(|parser| parser.unary()).and_then(|value| {
                    arithmetic_number(&value).map(|number| Scalar::Number(-number))
                })
            }
            _ => self.primary(),
        }
    }

    fn primary(&mut self) -> Option<Scalar> {
        match self.next()? {
            Token::Number(value) => Some(Scalar::Number(value)),
            Token::Text(value) => Some(Scalar::Text(value)),
            Token::Reference(reference) => self
                .context
                .value_for_reference(self.sheet_index, &reference),
            Token::Identifier(name) => match name.as_str() {
                "TRUE" => Some(Scalar::Boolean(true)),
                "FALSE" => Some(Scalar::Boolean(false)),
                _ => self.function(&name),
            },
            Token::LeftParen => {
                let value = self.recurse(|parser| parser.expression())?;
                self.consume(Token::RightParen).then_some(value)
            }
            _ => None,
        }
    }

    fn function(&mut self, name: &str) -> Option<Scalar> {
        if !self.consume(Token::LeftParen) {
            return None;
        }
        let mut arguments = Vec::new();
        if !matches!(self.peek(), Some(Token::RightParen)) {
            loop {
                if arguments.len() >= MAX_FUNCTION_ARGUMENTS {
                    return None;
                }
                arguments.push(self.argument()?);
                if self.consume(Token::Comma) {
                    continue;
                }
                break;
            }
        }
        if !self.consume(Token::RightParen) {
            return None;
        }

        match name {
            "IF" => {
                if arguments.len() < 2 || arguments.len() > 3 {
                    return None;
                }
                let condition = self.argument_scalar(&arguments[0])?;
                if condition.truthy() {
                    self.argument_scalar(&arguments[1])
                } else {
                    arguments
                        .get(2)
                        .map(|argument| self.argument_scalar(argument))
                        .unwrap_or(Some(Scalar::Boolean(false)))
                }
            }
            "ABS" => arithmetic_number(&self.argument_scalar(arguments.first()?)?)
                .map(|value| Scalar::Number(value.abs())),
            "SUM" => Some(Scalar::Number(
                self.expand_arguments(&arguments)?
                    .iter()
                    .filter_map(Scalar::as_number)
                    .sum(),
            )),
            "AVERAGE" => {
                let values = self
                    .expand_arguments(&arguments)?
                    .into_iter()
                    .filter_map(|value| value.as_number())
                    .collect::<Vec<_>>();
                (!values.is_empty())
                    .then(|| Scalar::Number(values.iter().sum::<f64>() / values.len() as f64))
            }
            "MIN" | "MAX" => {
                let values = self
                    .expand_arguments(&arguments)?
                    .into_iter()
                    .filter_map(|value| value.as_number())
                    .collect::<Vec<_>>();
                let result = if name == "MIN" {
                    values.into_iter().reduce(f64::min)
                } else {
                    values.into_iter().reduce(f64::max)
                }?;
                Some(Scalar::Number(result))
            }
            "COUNT" => Some(Scalar::Number(
                self.expand_arguments(&arguments)?
                    .iter()
                    .filter(|value| value.as_number().is_some())
                    .count() as f64,
            )),
            "COUNTA" => Some(Scalar::Number(
                self.expand_arguments(&arguments)?
                    .iter()
                    .filter(|value| !value.is_blank())
                    .count() as f64,
            )),
            "COUNTBLANK" => Some(Scalar::Number(
                self.expand_arguments(&arguments)?
                    .iter()
                    .filter(|value| value.is_blank())
                    .count() as f64,
            )),
            "COUNTIF" => {
                let range = arguments.first()?;
                let criterion = self.argument_scalar(arguments.get(1)?)?;
                Some(Scalar::Number(
                    self.expand_argument(range)?
                        .iter()
                        .filter(|value| criteria_match(value, &criterion))
                        .count() as f64,
                ))
            }
            "COUNTIFS" => {
                if arguments.len() < 2 || arguments.len() % 2 != 0 {
                    return None;
                }
                let ranges = arguments
                    .chunks_exact(2)
                    .map(|pair| {
                        let values = self.expand_argument(&pair[0])?;
                        let criterion = self.argument_scalar(&pair[1])?;
                        Some((values, criterion))
                    })
                    .collect::<Option<Vec<_>>>()?;
                let length = ranges.first()?.0.len();
                if ranges.iter().any(|(values, _)| values.len() != length) {
                    return None;
                }
                Some(Scalar::Number(
                    (0..length)
                        .filter(|index| {
                            ranges.iter().all(|(values, criterion)| {
                                criteria_match(&values[*index], criterion)
                            })
                        })
                        .count() as f64,
                ))
            }
            _ => None,
        }
    }

    fn argument(&mut self) -> Option<Argument> {
        if let (Some(Token::Reference(start)), Some(Token::Colon), Some(Token::Reference(end))) = (
            self.tokens.get(self.cursor),
            self.tokens.get(self.cursor + 1),
            self.tokens.get(self.cursor + 2),
        ) {
            let argument = Argument::Range(start.clone(), end.clone());
            self.cursor += 3;
            return Some(argument);
        }
        self.recurse(|parser| parser.expression())
            .map(Argument::Value)
    }

    fn argument_scalar(&mut self, argument: &Argument) -> Option<Scalar> {
        match argument {
            Argument::Value(value) => Some(value.clone()),
            Argument::Range(_, _) => None,
        }
    }

    fn expand_arguments(&mut self, arguments: &[Argument]) -> Option<Vec<Scalar>> {
        let mut values = Vec::new();
        for argument in arguments {
            values.extend(self.expand_argument(argument)?);
        }
        Some(values)
    }

    fn expand_argument(&mut self, argument: &Argument) -> Option<Vec<Scalar>> {
        match argument {
            Argument::Value(value) => {
                if self.expansion_budget == 0 || !self.context.budget.consume_expanded_values(1) {
                    return None;
                }
                self.expansion_budget -= 1;
                Some(vec![value.clone()])
            }
            Argument::Range(start, end) => {
                let sheet_name = start.sheet.clone().or_else(|| end.sheet.clone());
                if start.sheet.is_some()
                    && end.sheet.is_some()
                    && start.sheet.as_ref() != end.sheet.as_ref()
                {
                    return None;
                }
                if end.coord.row < start.coord.row || end.coord.column < start.coord.column {
                    return None;
                }
                let cell_count = u64::from(end.coord.row - start.coord.row + 1)
                    * u64::from(end.coord.column - start.coord.column + 1);
                if cell_count > MAX_RANGE_CELLS {
                    return None;
                }
                let cell_count = usize::try_from(cell_count).ok()?;
                if cell_count > self.expansion_budget
                    || !self.context.budget.consume_expanded_values(cell_count)
                {
                    return None;
                }
                self.expansion_budget -= cell_count;
                let mut values = Vec::with_capacity(cell_count);
                for row in start.coord.row..=end.coord.row {
                    for column in start.coord.column..=end.coord.column {
                        let reference = CellReference {
                            sheet: sheet_name.clone(),
                            coord: CellCoord::new(row, column),
                        };
                        values.push(
                            self.context
                                .value_for_reference(self.sheet_index, &reference)?,
                        );
                    }
                }
                Some(values)
            }
        }
    }

    fn recurse<T>(&mut self, operation: impl FnOnce(&mut Self) -> Option<T>) -> Option<T> {
        if self.parse_depth >= MAX_PARSE_DEPTH {
            return None;
        }
        self.parse_depth += 1;
        let result = operation(self);
        self.parse_depth -= 1;
        result
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.cursor)
    }

    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.cursor)?.clone();
        self.cursor += 1;
        Some(token)
    }

    fn consume(&mut self, expected: Token) -> bool {
        if self.peek() == Some(&expected) {
            self.cursor += 1;
            true
        } else {
            false
        }
    }
}

fn numeric_binary(
    left: &Scalar,
    right: &Scalar,
    operation: impl FnOnce(f64, f64) -> f64,
) -> Option<Scalar> {
    let result = operation(arithmetic_number(left)?, arithmetic_number(right)?);
    result.is_finite().then_some(Scalar::Number(result))
}

fn arithmetic_number(value: &Scalar) -> Option<f64> {
    match value {
        Scalar::Blank => Some(0.0),
        _ => value.as_number(),
    }
}

fn scalar_compare(left: &Scalar, right: &Scalar) -> i8 {
    if let (Some(left), Some(right)) = (left.as_number(), right.as_number()) {
        return left.partial_cmp(&right).map_or(0, |order| order as i8);
    }
    let text = |value: &Scalar| match value {
        Scalar::Text(value) => value.to_ascii_lowercase(),
        Scalar::Boolean(value) => value.to_string(),
        Scalar::Blank => String::new(),
        Scalar::Error(value) => value.to_ascii_lowercase(),
        Scalar::Number(value) => value.to_string(),
    };
    text(left).cmp(&text(right)) as i8
}

fn criteria_match(value: &Scalar, criterion: &Scalar) -> bool {
    match criterion {
        Scalar::Text(criteria) => {
            let (operator, expected) = if let Some(expected) = criteria.strip_prefix(">=") {
                (Some(Token::GreaterEqual), expected)
            } else if let Some(expected) = criteria.strip_prefix("<=") {
                (Some(Token::LessEqual), expected)
            } else if let Some(expected) = criteria.strip_prefix("<>") {
                (Some(Token::NotEqual), expected)
            } else if let Some(expected) = criteria.strip_prefix('>') {
                (Some(Token::Greater), expected)
            } else if let Some(expected) = criteria.strip_prefix('<') {
                (Some(Token::Less), expected)
            } else if let Some(expected) = criteria.strip_prefix('=') {
                (Some(Token::Equal), expected)
            } else {
                (None, criteria.as_str())
            };
            let comparison = scalar_compare(value, &Scalar::Text(expected.to_string()));
            match operator {
                Some(Token::GreaterEqual) => comparison >= 0,
                Some(Token::LessEqual) => comparison <= 0,
                Some(Token::NotEqual) => comparison != 0,
                Some(Token::Greater) => comparison > 0,
                Some(Token::Less) => comparison < 0,
                Some(Token::Equal) | None => comparison == 0,
                _ => false,
            }
        }
        _ => scalar_compare(value, criterion) == 0,
    }
}

fn tokenize(source: &str) -> Option<Vec<Token>> {
    let characters = source.chars().collect::<Vec<_>>();
    let mut cursor = 0usize;
    let mut tokens = Vec::new();
    while cursor < characters.len() {
        if tokens.len() >= MAX_TOKENS {
            return None;
        }
        let character = characters[cursor];
        match character {
            value if value.is_whitespace() => cursor += 1,
            '+' => push_token(&mut tokens, Token::Plus, &mut cursor),
            '-' => push_token(&mut tokens, Token::Minus, &mut cursor),
            '*' => push_token(&mut tokens, Token::Star, &mut cursor),
            '/' => push_token(&mut tokens, Token::Slash, &mut cursor),
            ':' => push_token(&mut tokens, Token::Colon, &mut cursor),
            ',' | ';' => push_token(&mut tokens, Token::Comma, &mut cursor),
            '(' => push_token(&mut tokens, Token::LeftParen, &mut cursor),
            ')' => push_token(&mut tokens, Token::RightParen, &mut cursor),
            '=' => push_token(&mut tokens, Token::Equal, &mut cursor),
            '<' => {
                cursor += 1;
                if characters.get(cursor) == Some(&'=') {
                    cursor += 1;
                    tokens.push(Token::LessEqual);
                } else if characters.get(cursor) == Some(&'>') {
                    cursor += 1;
                    tokens.push(Token::NotEqual);
                } else {
                    tokens.push(Token::Less);
                }
            }
            '>' => {
                cursor += 1;
                if characters.get(cursor) == Some(&'=') {
                    cursor += 1;
                    tokens.push(Token::GreaterEqual);
                } else {
                    tokens.push(Token::Greater);
                }
            }
            '"' => {
                cursor += 1;
                let mut value = String::new();
                let mut closed = false;
                while cursor < characters.len() {
                    if characters[cursor] == '"' {
                        if characters.get(cursor + 1) == Some(&'"') {
                            value.push('"');
                            cursor += 2;
                        } else {
                            cursor += 1;
                            closed = true;
                            break;
                        }
                    } else {
                        value.push(characters[cursor]);
                        cursor += 1;
                    }
                }
                if !closed {
                    return None;
                }
                tokens.push(Token::Text(value));
            }
            '\'' => {
                let (reference, next_cursor) = parse_quoted_reference(&characters, cursor)?;
                tokens.push(Token::Reference(reference));
                cursor = next_cursor;
            }
            value if value.is_ascii_digit() || value == '.' => {
                let start = cursor;
                cursor += 1;
                while cursor < characters.len()
                    && (characters[cursor].is_ascii_digit()
                        || characters[cursor] == '.'
                        || characters[cursor] == 'e'
                        || characters[cursor] == 'E'
                        || ((characters[cursor] == '+' || characters[cursor] == '-')
                            && matches!(characters.get(cursor.wrapping_sub(1)), Some('e' | 'E'))))
                {
                    cursor += 1;
                }
                tokens.push(Token::Number(
                    characters[start..cursor]
                        .iter()
                        .collect::<String>()
                        .parse()
                        .ok()?,
                ));
            }
            value if value.is_ascii_alphabetic() || value == '$' || value == '_' => {
                let start = cursor;
                cursor += 1;
                while cursor < characters.len()
                    && (characters[cursor].is_ascii_alphanumeric()
                        || matches!(characters[cursor], '$' | '_' | '.'))
                {
                    cursor += 1;
                }
                let raw = characters[start..cursor].iter().collect::<String>();
                if characters.get(cursor) == Some(&'!') {
                    cursor += 1;
                    let (coord, next_cursor) = parse_reference_address(&characters, cursor)?;
                    tokens.push(Token::Reference(CellReference {
                        sheet: Some(raw),
                        coord,
                    }));
                    cursor = next_cursor;
                } else if let Ok(coord) = parse_address(&raw) {
                    tokens.push(Token::Reference(CellReference { sheet: None, coord }));
                } else {
                    tokens.push(Token::Identifier(raw.to_ascii_uppercase()));
                }
            }
            _ => return None,
        }
    }
    Some(tokens)
}

fn parse_quoted_reference(
    characters: &[char],
    mut cursor: usize,
) -> Option<(CellReference, usize)> {
    cursor += 1;
    let mut sheet = String::new();
    let mut closed = false;
    while cursor < characters.len() {
        if characters[cursor] == '\'' {
            if characters.get(cursor + 1) == Some(&'\'') {
                sheet.push('\'');
                cursor += 2;
            } else {
                cursor += 1;
                closed = true;
                break;
            }
        } else {
            sheet.push(characters[cursor]);
            cursor += 1;
        }
    }
    if !closed || characters.get(cursor) != Some(&'!') {
        return None;
    }
    cursor += 1;
    let (coord, cursor) = parse_reference_address(characters, cursor)?;
    Some((
        CellReference {
            sheet: Some(sheet),
            coord,
        },
        cursor,
    ))
}

fn parse_reference_address(characters: &[char], mut cursor: usize) -> Option<(CellCoord, usize)> {
    let start = cursor;
    while cursor < characters.len()
        && (characters[cursor].is_ascii_alphanumeric() || characters[cursor] == '$')
    {
        cursor += 1;
    }
    let raw = characters.get(start..cursor)?.iter().collect::<String>();
    Some((parse_address(&raw).ok()?, cursor))
}

fn push_token(tokens: &mut Vec<Token>, token: Token, cursor: &mut usize) {
    tokens.push(token);
    *cursor += 1;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Cell;

    fn sheet() -> Worksheet {
        let mut sheet = Worksheet::new("Sheet1");
        for (row, value) in [10.0, 20.0, 30.0].into_iter().enumerate() {
            sheet.insert(Cell {
                coord: CellCoord::new(row as u32, 0),
                value: CellValue::Number(value),
                formula: None,
                style_id: 0,
            });
        }
        sheet
    }

    fn workbook_with_cross_sheet_cells() -> Workbook {
        let mut source = Worksheet::new("Input Data");
        source.insert(Cell {
            coord: CellCoord::new(0, 0),
            value: CellValue::Number(12.0),
            formula: None,
            style_id: 0,
        });
        source.insert(Cell {
            coord: CellCoord::new(1, 0),
            value: CellValue::Number(8.0),
            formula: None,
            style_id: 0,
        });
        source.insert(Cell {
            coord: CellCoord::new(0, 1),
            value: CellValue::String("Low".into()),
            formula: None,
            style_id: 0,
        });
        let mut output = Worksheet::new("Output Sheet");
        output.insert(Cell {
            coord: CellCoord::new(0, 0),
            value: CellValue::Blank,
            formula: Some("='Input Data'!$A$1+'Input Data'!A2".into()),
            style_id: 0,
        });
        output.insert(Cell {
            coord: CellCoord::new(1, 0),
            value: CellValue::Blank,
            formula: Some("=IF('Input Data'!$B$1=\"Low\",A1,0)".into()),
            style_id: 0,
        });
        Workbook {
            title: "Test.xlsx".into(),
            sheets: vec![source, output],
            styles: vec![CellStyle::default()],
            date_1904: false,
        }
    }

    #[test]
    fn evaluates_arithmetic_and_ranges() {
        let sheet = sheet();
        assert_eq!(evaluate_formula(&sheet, "=SUM(A1:A3) + 5 * 2"), Some(70.0));
        assert_eq!(evaluate_formula(&sheet, "=AVERAGE(A1:A3)"), Some(20.0));
        assert_eq!(evaluate_formula(&sheet, "=B1+1"), Some(1.0));
        assert_eq!(
            evaluate_formula(&sheet, "=MAX(A1:A3)-MIN(A1:A3)"),
            Some(20.0)
        );
    }

    #[test]
    fn rejects_unsafe_or_unknown_expressions() {
        let sheet = sheet();
        assert_eq!(
            evaluate_formula(&sheet, "=WEBSERVICE(\"https://example.com\")"),
            None
        );
        assert_eq!(evaluate_formula(&sheet, "=1/0"), None);
    }

    #[test]
    fn evaluates_quoted_cross_sheet_absolute_references() {
        let workbook = workbook_with_cross_sheet_cells();
        assert_eq!(
            evaluate_formula_in_workbook(&workbook, 1, "='Input Data'!$A$1+'Input Data'!A2"),
            Some(20.0)
        );
    }

    #[test]
    fn evaluates_cross_sheet_dependencies_and_text_if() {
        let mut workbook = workbook_with_cross_sheet_cells();
        evaluate_missing_formulas_in_workbook(&mut workbook);
        assert_eq!(
            workbook.sheets[1].cell(CellCoord::new(0, 0)).unwrap().value,
            CellValue::Number(20.0)
        );
        assert_eq!(
            workbook.sheets[1].cell(CellCoord::new(1, 0)).unwrap().value,
            CellValue::Number(20.0)
        );
    }

    #[test]
    fn evaluates_count_functions_against_cross_sheet_ranges() {
        let mut workbook = workbook_with_cross_sheet_cells();
        let mut checks = Worksheet::new("Checks");
        checks.insert(Cell {
            coord: CellCoord::new(0, 0),
            value: CellValue::Blank,
            formula: Some("=COUNTIF('Input Data'!B1:B2,\"Low\")".into()),
            style_id: 0,
        });
        checks.insert(Cell {
            coord: CellCoord::new(1, 0),
            value: CellValue::Blank,
            formula: Some("=COUNTA('Input Data'!A1:B2)".into()),
            style_id: 0,
        });
        workbook.sheets.push(checks);
        evaluate_missing_formulas_in_workbook(&mut workbook);
        assert_eq!(
            workbook.sheets[2].cell(CellCoord::new(0, 0)).unwrap().value,
            CellValue::Number(1.0)
        );
        assert_eq!(
            workbook.sheets[2].cell(CellCoord::new(1, 0)).unwrap().value,
            CellValue::Number(3.0)
        );
    }

    #[test]
    fn rejects_aggregate_expansion_over_budget() {
        let sheet = sheet();
        assert_eq!(evaluate_formula(&sheet, "=SUM(A1:A50000,B1:B50001)"), None);
    }

    #[test]
    fn shares_the_expansion_budget_across_workbook_recalculation() {
        let workbook = Workbook {
            title: "Budget.xlsx".into(),
            sheets: vec![Worksheet::new("Budget")],
            styles: vec![CellStyle::default()],
            date_1904: false,
        };
        let mut budget = EvaluationBudget::default();
        for _ in 0..(MAX_EXPANDED_VALUES_PER_WORKBOOK / MAX_RANGE_CELLS as usize) {
            assert!(
                evaluate_formula_value_in_workbook_with_budget(
                    &workbook,
                    0,
                    "=COUNTBLANK(A1:A100000)",
                    &mut budget,
                )
                .is_some()
            );
        }
        assert!(
            evaluate_formula_value_in_workbook_with_budget(
                &workbook,
                0,
                "=COUNTBLANK(A1:A100000)",
                &mut budget,
            )
            .is_none()
        );
    }

    #[test]
    fn rejects_excessive_function_arguments() {
        let formula = format!(
            "=SUM({})",
            std::iter::repeat_n("A1", MAX_FUNCTION_ARGUMENTS + 1)
                .collect::<Vec<_>>()
                .join(",")
        );
        assert_eq!(evaluate_formula(&sheet(), &formula), None);
    }

    #[test]
    fn rejects_deep_unary_and_parenthesized_expressions() {
        let unary = format!("={}1", "+".repeat(MAX_PARSE_DEPTH + 1));
        assert_eq!(evaluate_formula(&sheet(), &unary), None);

        let parenthesized = format!(
            "={}1{}",
            "(".repeat(MAX_PARSE_DEPTH + 1),
            ")".repeat(MAX_PARSE_DEPTH + 1)
        );
        assert_eq!(evaluate_formula(&sheet(), &parenthesized), None);
    }

    #[test]
    fn rejects_deep_blank_formula_reference_chain() {
        let mut chain = Worksheet::new("Chain");
        for row in 0..=MAX_REFERENCE_DEPTH as u32 + 8 {
            chain.insert(Cell {
                coord: CellCoord::new(row, 0),
                value: CellValue::Blank,
                formula: Some(format!("=A{}", row + 2)),
                style_id: 0,
            });
        }
        chain.insert(Cell {
            coord: CellCoord::new(MAX_REFERENCE_DEPTH as u32 + 9, 0),
            value: CellValue::Number(1.0),
            formula: None,
            style_id: 0,
        });
        let workbook = Workbook {
            title: "Chain.xlsx".into(),
            sheets: vec![chain],
            styles: vec![CellStyle::default()],
            date_1904: false,
        };

        assert_eq!(evaluate_formula_in_workbook(&workbook, 0, "=A1"), None);
    }
}
