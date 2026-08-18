use crate::model::CellValue;

pub fn format_cell(value: &CellValue, number_format: &str, date_1904: bool) -> String {
    match value {
        CellValue::Blank => String::new(),
        CellValue::String(value) | CellValue::Error(value) => value.clone(),
        CellValue::Boolean(value) => if *value { "TRUE" } else { "FALSE" }.into(),
        CellValue::Number(value) => format_number(*value, number_format, date_1904),
    }
}

pub fn format_number(value: f64, format_code: &str, date_1904: bool) -> String {
    if !value.is_finite() {
        return "#NUM!".into();
    }
    let code = normalize_code(format_code);
    let lower = code.to_ascii_lowercase();

    if is_date_format(&lower) {
        return format_excel_date(value, &lower, date_1904);
    }
    if lower.contains('%') {
        let decimals = decimal_places(&code);
        return format!("{}%", format_fixed(value * 100.0, decimals, false));
    }
    if lower.contains("e+") || lower.contains("e-") {
        let decimals = decimal_places(&code);
        return format!("{:.*E}", decimals, value);
    }

    let decimals = decimal_places(&code);
    let grouped = code.contains(',');
    let mut rendered = if code.eq_ignore_ascii_case("general") || code.is_empty() {
        format_general(value)
    } else {
        format_fixed(value.abs(), decimals, grouped)
    };
    if let Some(symbol) = currency_symbol(&code) {
        rendered = format!("{symbol}{rendered}");
    }
    if value < 0.0 {
        if code.contains('(') && code.contains(')') {
            rendered = format!("({rendered})");
        } else if !rendered.starts_with('-') {
            rendered.insert(0, '-');
        }
    }
    rendered
}

fn normalize_code(code: &str) -> String {
    let section = code.split(';').next().unwrap_or(code);
    let mut output = String::new();
    let mut quoted = false;
    let mut bracketed = false;
    let mut escaped = false;
    for character in section.chars() {
        if escaped {
            output.push(character);
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '"' => quoted = !quoted,
            '[' if !quoted => bracketed = true,
            ']' if !quoted => bracketed = false,
            '_' | '*' if !quoted && !bracketed => {}
            _ if !bracketed => output.push(character),
            _ => {}
        }
    }
    output.trim().to_string()
}

fn is_date_format(code: &str) -> bool {
    let without_literals = code
        .chars()
        .filter(|character| !matches!(character, '$' | '#' | '0' | ',' | '.' | '%' | '(' | ')'))
        .collect::<String>();
    without_literals.contains('y')
        || without_literals.contains('d')
        || (without_literals.contains('m')
            && (without_literals.contains('/')
                || without_literals.contains('-')
                || without_literals.contains('h')
                || without_literals.contains('s')))
}

fn decimal_places(code: &str) -> usize {
    let numeric = code.split('%').next().unwrap_or(code);
    let Some(decimal_index) = numeric.find('.') else {
        return 0;
    };
    numeric[decimal_index + 1..]
        .chars()
        .take_while(|character| matches!(character, '0' | '#'))
        .count()
        .min(10)
}

fn format_general(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{value:.0}")
    } else if value.abs() >= 1e11 || (value != 0.0 && value.abs() < 1e-9) {
        format!("{value:.6E}")
    } else {
        let rendered = format!("{value:.10}");
        rendered.trim_end_matches('0').trim_end_matches('.').into()
    }
}

fn format_fixed(value: f64, decimals: usize, grouped: bool) -> String {
    let rendered = format!("{value:.decimals$}");
    if !grouped {
        return rendered;
    }
    let (integer, fraction) = rendered
        .split_once('.')
        .map(|(integer, fraction)| (integer, Some(fraction)))
        .unwrap_or((&rendered, None));
    let mut grouped_integer = String::with_capacity(integer.len() + integer.len() / 3);
    for (index, character) in integer.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            grouped_integer.push(',');
        }
        grouped_integer.push(character);
    }
    let mut result: String = grouped_integer.chars().rev().collect();
    if let Some(fraction) = fraction {
        result.push('.');
        result.push_str(fraction);
    }
    result
}

fn currency_symbol(code: &str) -> Option<char> {
    ['$', '€', '£', '¥']
        .into_iter()
        .find(|symbol| code.contains(*symbol))
}

fn format_excel_date(serial: f64, code: &str, date_1904: bool) -> String {
    if !date_1904 && serial.floor() as i64 == 60 {
        return "02/29/1900".into();
    }
    let epoch_offset = if date_1904 { 24_107 } else { 25_569 };
    let mut whole_days = serial.floor() as i64 - epoch_offset;
    if !date_1904 && serial < 60.0 {
        whole_days += 1;
    }
    let (year, month, day) = civil_from_days(whole_days);
    let day_fraction = serial.rem_euclid(1.0);
    let total_seconds = (day_fraction * 86_400.0).round() as u32 % 86_400;
    let hour = total_seconds / 3_600;
    let minute = (total_seconds % 3_600) / 60;
    let second = total_seconds % 60;
    render_date_pattern(code, year, month, day, hour, minute, second)
}

fn render_date_pattern(
    code: &str,
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> String {
    let lower = code.to_ascii_lowercase();
    let characters = lower.chars().collect::<Vec<_>>();
    let time_only = !lower.contains('y')
        && !lower.contains('d')
        && (lower.contains('h') || lower.contains('s'));
    let mut output = String::new();
    let mut cursor = 0usize;
    let mut time_started = false;

    while cursor < characters.len() {
        if characters[cursor].is_ascii_whitespace() {
            output.push(characters[cursor]);
            cursor += 1;
            continue;
        }
        if characters[cursor..].starts_with(&['a', 'm', '/', 'p', 'm']) {
            output.push_str(if hour < 12 { "AM" } else { "PM" });
            cursor += 5;
            time_started = true;
            continue;
        }
        let token = characters[cursor];
        let run = characters[cursor..]
            .iter()
            .take_while(|character| **character == token)
            .count();
        match token {
            'y' => match run {
                1 | 2 => output.push_str(&format!("{:02}", year.rem_euclid(100))),
                _ => output.push_str(&format!("{year:04}")),
            },
            'm' if !time_started && !time_only => match run {
                1 => output.push_str(&format!("{month}")),
                2 => output.push_str(&format!("{month:02}")),
                3 => output.push_str(month_name(month)),
                _ => output.push_str(full_month_name(month)),
            },
            'm' => match run {
                1 => output.push_str(&format!("{minute}")),
                _ => output.push_str(&format!("{minute:02}")),
            },
            'd' => match run {
                1 => output.push_str(&format!("{day}")),
                2 => output.push_str(&format!("{day:02}")),
                3 => output.push_str(weekday_name(year, month, day)),
                _ => output.push_str(full_weekday_name(year, month, day)),
            },
            'h' => {
                let display_hour = if lower.contains("am/pm") {
                    let value = hour % 12;
                    if value == 0 { 12 } else { value }
                } else {
                    hour
                };
                if run == 1 {
                    output.push_str(&format!("{display_hour}"));
                } else {
                    output.push_str(&format!("{display_hour:02}"));
                }
                time_started = true;
            }
            's' => {
                if run == 1 {
                    output.push_str(&format!("{second}"));
                } else {
                    output.push_str(&format!("{second:02}"));
                }
                time_started = true;
            }
            _ => output.push(token),
        }
        cursor += run.max(1);
    }

    if output.is_empty() {
        format!("{month:02}/{day:02}/{year:04}")
    } else {
        output
    }
}

fn month_name(month: u32) -> &'static str {
    [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    .get(month.saturating_sub(1) as usize)
    .copied()
    .unwrap_or("Jan")
}

fn full_month_name(month: u32) -> &'static str {
    [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ]
    .get(month.saturating_sub(1) as usize)
    .copied()
    .unwrap_or("January")
}

fn weekday_name(year: i32, month: u32, day: u32) -> &'static str {
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday(year, month, day) as usize]
}

fn full_weekday_name(year: i32, month: u32, day: u32) -> &'static str {
    [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ][weekday(year, month, day) as usize]
}

fn weekday(year: i32, month: u32, day: u32) -> u32 {
    // Sakamoto's Gregorian weekday algorithm; 0 = Sunday.
    let offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let adjusted_year = year - i32::from(month < 3);
    (adjusted_year + adjusted_year / 4 - adjusted_year / 100
        + adjusted_year / 400
        + offsets[month.saturating_sub(1) as usize]
        + day as i32)
        .rem_euclid(7) as u32
}

// Howard Hinnant's civil calendar conversion, with z measured from 1970-01-01.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i32 + era as i32 * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    let year = year + i32::from(month <= 2);
    (year, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_common_excel_numbers() {
        assert_eq!(format_number(5170000.0, "$#,##0", false), "$5,170,000");
        assert_eq!(format_number(0.138, "0.0%", false), "13.8%");
        assert_eq!(
            format_number(-1200.5, "$#,##0.00;($#,##0.00)", false),
            "-$1,200.50"
        );
        assert_eq!(format_number(42.125, "General", false), "42.125");
    }

    #[test]
    fn formats_excel_dates() {
        assert_eq!(format_number(45_292.0, "mm/dd/yyyy", false), "01/01/2024");
        assert_eq!(
            format_number(45_292.5, "mm/dd/yyyy hh:mm:ss", false),
            "01/01/2024 12:00:00"
        );
        assert_eq!(
            format_number(46_251.791666666664, "yyyy-mm-dd", false),
            "2026-08-17"
        );
        assert_eq!(format_number(45_292.5, "d-mmm-yy", false), "1-Jan-24");
    }
}
