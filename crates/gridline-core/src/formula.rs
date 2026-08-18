use crate::model::{CellCoord, CellValue, Worksheet, parse_address};

const MAX_TOKENS: usize = 4_096;
const MAX_RANGE_CELLS: u64 = 100_000;

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Reference(CellCoord),
    Identifier(String),
    Plus,
    Minus,
    Star,
    Slash,
    Colon,
    Comma,
    LeftParen,
    RightParen,
}

#[derive(Debug, Clone, Copy)]
enum Argument {
    Value(f64),
    Range(CellCoord, CellCoord),
}

pub fn evaluate_formula(sheet: &Worksheet, formula: &str) -> Option<f64> {
    let tokens = tokenize(formula.strip_prefix('=').unwrap_or(formula))?;
    let mut parser = Parser {
        sheet,
        tokens,
        cursor: 0,
    };
    let result = parser.expression()?;
    (parser.cursor == parser.tokens.len() && result.is_finite()).then_some(result)
}

pub fn evaluate_missing_formulas(sheet: &mut Worksheet) {
    for _ in 0..4 {
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
        let mut updates = Vec::new();
        for (coord, formula) in pending {
            if let Some(value) = evaluate_formula(sheet, &formula) {
                updates.push((coord, value));
            }
        }
        if updates.is_empty() {
            break;
        }
        for (coord, value) in updates {
            if let Some(cell) = sheet.cells.get_mut(&coord) {
                cell.value = CellValue::Number(value);
            }
        }
    }
}

struct Parser<'a> {
    sheet: &'a Worksheet,
    tokens: Vec<Token>,
    cursor: usize,
}

impl Parser<'_> {
    fn expression(&mut self) -> Option<f64> {
        let mut value = self.term()?;
        loop {
            match self.peek() {
                Some(Token::Plus) => {
                    self.cursor += 1;
                    value += self.term()?;
                }
                Some(Token::Minus) => {
                    self.cursor += 1;
                    value -= self.term()?;
                }
                _ => return Some(value),
            }
        }
    }

    fn term(&mut self) -> Option<f64> {
        let mut value = self.unary()?;
        loop {
            match self.peek() {
                Some(Token::Star) => {
                    self.cursor += 1;
                    value *= self.unary()?;
                }
                Some(Token::Slash) => {
                    self.cursor += 1;
                    let divisor = self.unary()?;
                    if divisor.abs() < f64::EPSILON {
                        return None;
                    }
                    value /= divisor;
                }
                _ => return Some(value),
            }
        }
    }

    fn unary(&mut self) -> Option<f64> {
        match self.peek() {
            Some(Token::Plus) => {
                self.cursor += 1;
                self.unary()
            }
            Some(Token::Minus) => {
                self.cursor += 1;
                self.unary().map(|value| -value)
            }
            _ => self.primary(),
        }
    }

    fn primary(&mut self) -> Option<f64> {
        match self.next()? {
            Token::Number(value) => Some(value),
            Token::Reference(coord) => Some(self.numeric_cell(coord).unwrap_or(0.0)),
            Token::Identifier(name) => self.function(&name),
            Token::LeftParen => {
                let value = self.expression()?;
                self.consume(Token::RightParen).then_some(value)
            }
            _ => None,
        }
    }

    fn function(&mut self, name: &str) -> Option<f64> {
        if !self.consume(Token::LeftParen) {
            return None;
        }
        let mut arguments = Vec::new();
        if !matches!(self.peek(), Some(Token::RightParen)) {
            loop {
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
        let values = self.expand_arguments(&arguments)?;
        match name {
            "SUM" => Some(values.iter().sum()),
            "AVERAGE" => {
                (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
            }
            "MIN" => values.into_iter().reduce(f64::min),
            "MAX" => values.into_iter().reduce(f64::max),
            "COUNT" => Some(values.len() as f64),
            _ => None,
        }
    }

    fn argument(&mut self) -> Option<Argument> {
        if let (Some(Token::Reference(start)), Some(Token::Colon), Some(Token::Reference(end))) = (
            self.tokens.get(self.cursor),
            self.tokens.get(self.cursor + 1),
            self.tokens.get(self.cursor + 2),
        ) {
            let argument = Argument::Range(*start, *end);
            self.cursor += 3;
            return Some(argument);
        }
        self.expression().map(Argument::Value)
    }

    fn expand_arguments(&self, arguments: &[Argument]) -> Option<Vec<f64>> {
        let mut values = Vec::new();
        for argument in arguments {
            match argument {
                Argument::Value(value) => values.push(*value),
                Argument::Range(start, end) => {
                    if end.row < start.row || end.column < start.column {
                        return None;
                    }
                    let cell_count = u64::from(end.row - start.row + 1)
                        * u64::from(end.column - start.column + 1);
                    if cell_count > MAX_RANGE_CELLS {
                        return None;
                    }
                    for row in start.row..=end.row {
                        for column in start.column..=end.column {
                            if let Some(value) = self.numeric_cell(CellCoord::new(row, column)) {
                                values.push(value);
                            }
                        }
                    }
                }
            }
        }
        Some(values)
    }

    fn numeric_cell(&self, coord: CellCoord) -> Option<f64> {
        self.sheet.cell(coord)?.value.as_number()
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
                if let Ok(coord) = parse_address(&raw) {
                    tokens.push(Token::Reference(coord));
                } else {
                    tokens.push(Token::Identifier(raw.to_ascii_uppercase()));
                }
            }
            _ => return None,
        }
    }
    Some(tokens)
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

    #[test]
    fn evaluates_arithmetic_and_ranges() {
        let sheet = sheet();
        assert_eq!(evaluate_formula(&sheet, "=SUM(A1:A3) + 5 * 2"), Some(70.0));
        assert_eq!(evaluate_formula(&sheet, "=AVERAGE(A1:A3)"), Some(20.0));
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
}
