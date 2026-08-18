use crate::formula::evaluate_missing_formulas;
use crate::model::{
    AlignmentStyle, BorderEdge, BorderStyle, Cell, CellCoord, CellStyle, CellValue, ChartPoint,
    ChartSpec, ColumnSpan, FontStyle, FreezePane, Workbook, Worksheet, parse_address, parse_range,
};
use crate::{GridlineError, Result};
use quick_xml::Reader;
use quick_xml::events::{BytesCData, BytesRef, BytesStart, BytesText, Event};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;

const MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PART_BYTES: u64 = 96 * 1024 * 1024;
const MAX_SHEETS: usize = 256;
const MAX_CELLS: usize = 2_000_000;
const MAX_CHART_POINTS: u64 = 10_000;
const MAX_CHART_ANCHOR_SPAN: u32 = 4_096;

#[derive(Debug)]
struct SheetDescriptor {
    name: String,
    state: String,
    relationship_id: String,
}

#[derive(Debug)]
struct WorkbookDescriptor {
    sheets: Vec<SheetDescriptor>,
    date_1904: bool,
}

#[derive(Debug, Default)]
struct Relationship {
    target: String,
    external: bool,
    kind: String,
}

pub fn parse_workbook(bytes: &[u8]) -> Result<Workbook> {
    if bytes.is_empty() || bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(GridlineError::ResourceLimit(format!(
            "archive size must be between 1 byte and {MAX_ARCHIVE_BYTES} bytes"
        )));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let mut expanded = 0u64;
    let workbook_xml = read_required_part(&mut archive, "xl/workbook.xml", &mut expanded)?;
    let descriptor = parse_workbook_descriptor(&workbook_xml)?;
    if descriptor.sheets.len() > MAX_SHEETS {
        return Err(GridlineError::ResourceLimit(format!(
            "workbook contains {} sheets; limit is {MAX_SHEETS}",
            descriptor.sheets.len()
        )));
    }
    let relationships_xml =
        read_required_part(&mut archive, "xl/_rels/workbook.xml.rels", &mut expanded)?;
    let relationships = parse_relationships(&relationships_xml)?;
    let shared_strings = read_optional_part(&mut archive, "xl/sharedStrings.xml", &mut expanded)?
        .map(|xml| parse_shared_strings(&xml))
        .transpose()?
        .unwrap_or_default();
    let styles = read_optional_part(&mut archive, "xl/styles.xml", &mut expanded)?
        .map(|xml| parse_styles(&xml))
        .transpose()?
        .unwrap_or_else(|| vec![CellStyle::default()]);
    let title = read_optional_part(&mut archive, "docProps/core.xml", &mut expanded)?
        .map(|xml| parse_core_title(&xml))
        .transpose()?
        .flatten()
        .unwrap_or_else(|| "Workbook.xlsx".into());

    let mut sheets = Vec::with_capacity(descriptor.sheets.len());
    let mut sheet_targets = Vec::with_capacity(descriptor.sheets.len());
    let mut cell_count = 0usize;
    for sheet in descriptor.sheets {
        let relationship = relationships
            .get(&sheet.relationship_id)
            .ok_or_else(|| GridlineError::MissingPart(sheet.relationship_id.clone()))?;
        if relationship.external {
            continue;
        }
        let target = resolve_part("xl", &relationship.target)?;
        let worksheet_xml = read_required_part(&mut archive, &target, &mut expanded)?;
        let mut worksheet =
            parse_worksheet(&worksheet_xml, sheet.name, &shared_strings, styles.len())?;
        worksheet.state = sheet.state;
        evaluate_missing_formulas(&mut worksheet);
        cell_count += worksheet.cells.len();
        if cell_count > MAX_CELLS {
            return Err(GridlineError::ResourceLimit(format!(
                "workbook contains more than {MAX_CELLS} populated cells"
            )));
        }
        sheet_targets.push(target);
        sheets.push(worksheet);
    }
    if sheets.is_empty() {
        return Err(GridlineError::MissingPart(
            "no readable worksheets were found".into(),
        ));
    }

    let mut workbook = Workbook {
        title,
        sheets,
        styles,
        date_1904: descriptor.date_1904,
    };
    attach_charts(
        &mut workbook.sheets,
        &sheet_targets,
        &mut archive,
        &mut expanded,
    )?;
    Ok(workbook)
}

fn read_required_part(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    expanded: &mut u64,
) -> Result<Vec<u8>> {
    read_optional_part(archive, name, expanded)?
        .ok_or_else(|| GridlineError::MissingPart(name.into()))
}

fn read_optional_part(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    expanded: &mut u64,
) -> Result<Option<Vec<u8>>> {
    let file = match archive.by_name(name) {
        Ok(file) => file,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if file.size() > MAX_PART_BYTES || expanded.saturating_add(file.size()) > MAX_EXPANDED_BYTES {
        return Err(GridlineError::ResourceLimit(format!(
            "expanded OOXML part exceeds configured limit: {name}"
        )));
    }
    let expected_size = file.size();
    let mut bytes = Vec::with_capacity(expected_size.min(8 * 1024 * 1024) as usize);
    file.take(MAX_PART_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PART_BYTES {
        return Err(GridlineError::ResourceLimit(format!(
            "OOXML part exceeds {MAX_PART_BYTES} bytes: {name}"
        )));
    }
    *expanded += bytes.len() as u64;
    Ok(Some(bytes))
}

fn parse_workbook_descriptor(xml: &[u8]) -> Result<WorkbookDescriptor> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut sheets = Vec::new();
    let mut date_1904 = false;
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(event) | Event::Empty(event) if is_tag(&event, b"workbookPr") => {
                date_1904 = attribute(&reader, &event, b"date1904")?
                    .is_some_and(|value| parse_bool(&value));
            }
            Event::Start(event) | Event::Empty(event) if is_tag(&event, b"sheet") => {
                let name = attribute(&reader, &event, b"name")?
                    .ok_or_else(|| GridlineError::Xml("sheet is missing a name".into()))?;
                let relationship_id = attribute(&reader, &event, b"id")?
                    .ok_or_else(|| GridlineError::Xml(format!("sheet {name} is missing r:id")))?;
                sheets.push(SheetDescriptor {
                    name,
                    state: attribute(&reader, &event, b"state")?
                        .unwrap_or_else(|| "visible".into()),
                    relationship_id,
                });
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(WorkbookDescriptor { sheets, date_1904 })
}

fn parse_relationships(xml: &[u8]) -> Result<HashMap<String, Relationship>> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut relationships = HashMap::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(event) | Event::Empty(event) if is_tag(&event, b"Relationship") => {
                let Some(id) = attribute(&reader, &event, b"Id")? else {
                    buffer.clear();
                    continue;
                };
                let target = attribute(&reader, &event, b"Target")?.ok_or_else(|| {
                    GridlineError::Xml(format!("relationship {id} has no target"))
                })?;
                let kind = attribute(&reader, &event, b"Type")?.unwrap_or_default();
                let external = attribute(&reader, &event, b"TargetMode")?
                    .is_some_and(|value| value.eq_ignore_ascii_case("external"));
                relationships.insert(
                    id,
                    Relationship {
                        target,
                        external,
                        kind,
                    },
                );
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(relationships)
}

fn parse_shared_strings(xml: &[u8]) -> Result<Vec<String>> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut strings = Vec::new();
    let mut current: Option<String> = None;
    let mut in_text = false;
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(event) if is_tag(&event, b"si") => current = Some(String::new()),
            Event::Start(event) if is_tag(&event, b"t") => in_text = true,
            Event::Text(text) if in_text => {
                if let Some(current) = &mut current {
                    current.push_str(&decode_text(&text)?);
                }
            }
            Event::CData(text) if in_text => {
                if let Some(current) = &mut current {
                    current.push_str(&decode_cdata(&text)?);
                }
            }
            Event::GeneralRef(reference) if in_text => {
                if let Some(current) = &mut current {
                    current.push_str(&decode_reference(&reference)?);
                }
            }
            Event::End(event) if event.local_name().as_ref() == b"t" => in_text = false,
            Event::End(event) if event.local_name().as_ref() == b"si" => {
                strings.push(current.take().unwrap_or_default());
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(strings)
}

#[derive(Debug, Default)]
struct StyleReference {
    font_id: usize,
    fill_id: usize,
    border_id: usize,
    number_format_id: u32,
    alignment: AlignmentStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StyleSection {
    None,
    Fonts,
    Fills,
    Borders,
    CellFormats,
}

fn parse_styles(xml: &[u8]) -> Result<Vec<CellStyle>> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut section = StyleSection::None;
    let mut fonts = Vec::new();
    let mut fills = Vec::new();
    let mut borders = Vec::new();
    let mut formats = Vec::new();
    let mut custom_number_formats = HashMap::new();
    let mut current_font: Option<FontStyle> = None;
    let mut current_fill: Option<Option<String>> = None;
    let mut current_border: Option<BorderStyle> = None;
    let mut current_side: Option<String> = None;
    let mut current_format: Option<StyleReference> = None;

    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(event) => {
                let local = event.local_name();
                let name = local.as_ref();
                match name {
                    b"fonts" => section = StyleSection::Fonts,
                    b"fills" => section = StyleSection::Fills,
                    b"borders" => section = StyleSection::Borders,
                    b"cellXfs" => section = StyleSection::CellFormats,
                    b"font" if section == StyleSection::Fonts => {
                        current_font = Some(default_font());
                    }
                    b"fill" if section == StyleSection::Fills => current_fill = Some(None),
                    b"border" if section == StyleSection::Borders => {
                        current_border = Some(BorderStyle::default())
                    }
                    b"xf" if section == StyleSection::CellFormats => {
                        current_format = Some(style_reference(&reader, &event)?)
                    }
                    b"alignment" if section == StyleSection::CellFormats => {
                        if let Some(format) = &mut current_format {
                            format.alignment = parse_alignment(&reader, &event)?;
                        }
                    }
                    b"left" | b"right" | b"top" | b"bottom" if section == StyleSection::Borders => {
                        current_side = Some(String::from_utf8_lossy(name).into_owned());
                        apply_border_side(
                            current_border.as_mut(),
                            current_side.as_deref(),
                            attribute(&reader, &event, b"style")?,
                            None,
                        );
                    }
                    b"color" if section == StyleSection::Borders => {
                        let color = parse_color(&reader, &event)?;
                        apply_border_side(
                            current_border.as_mut(),
                            current_side.as_deref(),
                            None,
                            color,
                        );
                    }
                    _ => handle_style_leaf(
                        &reader,
                        &event,
                        section,
                        &mut current_font,
                        &mut current_fill,
                        &mut custom_number_formats,
                    )?,
                }
            }
            Event::Empty(event) => {
                let local = event.local_name();
                let name = local.as_ref();
                match name {
                    b"numFmt" => {
                        if let (Some(id), Some(code)) = (
                            attribute(&reader, &event, b"numFmtId")?,
                            attribute(&reader, &event, b"formatCode")?,
                        ) && let Ok(id) = id.parse()
                        {
                            custom_number_formats.insert(id, code);
                        }
                    }
                    b"xf" if section == StyleSection::CellFormats => {
                        formats.push(style_reference(&reader, &event)?);
                    }
                    b"alignment" if section == StyleSection::CellFormats => {
                        if let Some(format) = &mut current_format {
                            format.alignment = parse_alignment(&reader, &event)?;
                        }
                    }
                    b"left" | b"right" | b"top" | b"bottom" if section == StyleSection::Borders => {
                        let side = String::from_utf8_lossy(name).into_owned();
                        apply_border_side(
                            current_border.as_mut(),
                            Some(&side),
                            attribute(&reader, &event, b"style")?,
                            None,
                        );
                    }
                    b"color" if section == StyleSection::Borders => {
                        let color = parse_color(&reader, &event)?;
                        apply_border_side(
                            current_border.as_mut(),
                            current_side.as_deref(),
                            None,
                            color,
                        );
                    }
                    _ => handle_style_leaf(
                        &reader,
                        &event,
                        section,
                        &mut current_font,
                        &mut current_fill,
                        &mut custom_number_formats,
                    )?,
                }
            }
            Event::End(event) => match event.local_name().as_ref() {
                b"fonts" | b"fills" | b"borders" | b"cellXfs" => section = StyleSection::None,
                b"font" => {
                    if let Some(font) = current_font.take() {
                        fonts.push(font);
                    }
                }
                b"fill" => {
                    if let Some(fill) = current_fill.take() {
                        fills.push(fill);
                    }
                }
                b"border" => {
                    if let Some(border) = current_border.take() {
                        borders.push(border);
                    }
                }
                b"left" | b"right" | b"top" | b"bottom" => current_side = None,
                b"xf" => {
                    if let Some(format) = current_format.take() {
                        formats.push(format);
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }

    if fonts.is_empty() {
        fonts.push(default_font());
    }
    if fills.is_empty() {
        fills.push(None);
    }
    if borders.is_empty() {
        borders.push(BorderStyle::default());
    }
    if formats.is_empty() {
        formats.push(StyleReference::default());
    }
    Ok(formats
        .into_iter()
        .map(|format| CellStyle {
            font: fonts
                .get(format.font_id)
                .cloned()
                .unwrap_or_else(default_font),
            fill: fills.get(format.fill_id).cloned().flatten(),
            border: borders.get(format.border_id).cloned().unwrap_or_default(),
            alignment: format.alignment,
            number_format: custom_number_formats
                .get(&format.number_format_id)
                .cloned()
                .unwrap_or_else(|| built_in_number_format(format.number_format_id).into()),
        })
        .collect())
}

fn handle_style_leaf(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    section: StyleSection,
    current_font: &mut Option<FontStyle>,
    current_fill: &mut Option<Option<String>>,
    custom_number_formats: &mut HashMap<u32, String>,
) -> Result<()> {
    let local = event.local_name();
    let name = local.as_ref();
    match (section, name) {
        (StyleSection::Fonts, b"b") => {
            if let Some(font) = current_font {
                font.bold = leaf_bool(reader, event)?;
            }
        }
        (StyleSection::Fonts, b"i") => {
            if let Some(font) = current_font {
                font.italic = leaf_bool(reader, event)?;
            }
        }
        (StyleSection::Fonts, b"u") => {
            if let Some(font) = current_font {
                font.underline = leaf_bool(reader, event)?;
            }
        }
        (StyleSection::Fonts, b"name") => {
            if let (Some(font), Some(value)) = (current_font, attribute(reader, event, b"val")?) {
                font.family = value;
            }
        }
        (StyleSection::Fonts, b"sz") => {
            if let (Some(font), Some(value)) = (current_font, attribute(reader, event, b"val")?) {
                font.size = value.parse().unwrap_or(11.0);
            }
        }
        (StyleSection::Fonts, b"color") => {
            if let Some(font) = current_font {
                font.color = parse_color(reader, event)?;
            }
        }
        (StyleSection::Fills, b"fgColor") => {
            if let Some(fill) = current_fill {
                *fill = parse_color(reader, event)?;
            }
        }
        (_, b"numFmt") => {
            if let (Some(id), Some(code)) = (
                attribute(reader, event, b"numFmtId")?,
                attribute(reader, event, b"formatCode")?,
            ) && let Ok(id) = id.parse()
            {
                custom_number_formats.insert(id, code);
            }
        }
        _ => {}
    }
    Ok(())
}

fn style_reference(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> Result<StyleReference> {
    Ok(StyleReference {
        font_id: numeric_attribute(reader, event, b"fontId")?.unwrap_or(0) as usize,
        fill_id: numeric_attribute(reader, event, b"fillId")?.unwrap_or(0) as usize,
        border_id: numeric_attribute(reader, event, b"borderId")?.unwrap_or(0) as usize,
        number_format_id: numeric_attribute(reader, event, b"numFmtId")?.unwrap_or(0),
        alignment: AlignmentStyle::default(),
    })
}

fn parse_alignment(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> Result<AlignmentStyle> {
    Ok(AlignmentStyle {
        horizontal: attribute(reader, event, b"horizontal")?,
        vertical: attribute(reader, event, b"vertical")?,
        wrap_text: attribute(reader, event, b"wrapText")?.is_some_and(|value| parse_bool(&value)),
    })
}

fn apply_border_side(
    border: Option<&mut BorderStyle>,
    side: Option<&str>,
    style: Option<String>,
    color: Option<String>,
) {
    let Some(border) = border else { return };
    let edge: &mut BorderEdge = match side {
        Some("top") => &mut border.top,
        Some("right") => &mut border.right,
        Some("bottom") => &mut border.bottom,
        Some("left") => &mut border.left,
        _ => return,
    };
    if style.is_some() {
        edge.style = style;
    }
    if color.is_some() {
        edge.color = color;
    }
}

fn parse_color(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> Result<Option<String>> {
    if let Some(rgb) = attribute(reader, event, b"rgb")? {
        let rgb = rgb.trim_start_matches('#');
        let rgb = if rgb.len() == 8 { &rgb[2..] } else { rgb };
        if rgb.len() == 6 && rgb.chars().all(|character| character.is_ascii_hexdigit()) {
            return Ok(Some(format!("#{}", rgb.to_ascii_uppercase())));
        }
    }
    if let Some(indexed) = numeric_attribute(reader, event, b"indexed")? {
        return Ok(indexed_color(indexed).map(str::to_string));
    }
    if let Some(theme) = numeric_attribute(reader, event, b"theme")? {
        return Ok(Some(theme_color(theme).into()));
    }
    Ok(None)
}

#[derive(Debug)]
struct CellBuilder {
    coord: CellCoord,
    cell_type: String,
    style_id: usize,
    value: Option<String>,
    formula: Option<String>,
    inline: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Capture {
    Value,
    Formula,
    Inline,
}

fn parse_worksheet(
    xml: &[u8],
    name: String,
    shared_strings: &[String],
    style_count: usize,
) -> Result<Worksheet> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut worksheet = Worksheet::new(name);
    let mut current_cell: Option<CellBuilder> = None;
    let mut capture: Option<Capture> = None;
    let mut capture_text = String::new();

    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(event) => {
                let local = event.local_name();
                let name = local.as_ref();
                match name {
                    b"dimension" => apply_dimension(&reader, &event, &mut worksheet)?,
                    b"row" => apply_row(&reader, &event, &mut worksheet)?,
                    b"col" => apply_column(&reader, &event, &mut worksheet)?,
                    b"c" => current_cell = Some(begin_cell(&reader, &event, style_count)?),
                    b"v" => begin_capture(&mut capture, &mut capture_text, Capture::Value),
                    b"f" => begin_capture(&mut capture, &mut capture_text, Capture::Formula),
                    b"t" if current_cell
                        .as_ref()
                        .is_some_and(|cell| cell.cell_type == "inlineStr") =>
                    {
                        begin_capture(&mut capture, &mut capture_text, Capture::Inline)
                    }
                    b"mergeCell" => apply_merge(&reader, &event, &mut worksheet)?,
                    b"pane" => apply_pane(&reader, &event, &mut worksheet)?,
                    _ => {}
                }
            }
            Event::Empty(event) => match event.local_name().as_ref() {
                b"dimension" => apply_dimension(&reader, &event, &mut worksheet)?,
                b"row" => apply_row(&reader, &event, &mut worksheet)?,
                b"col" => apply_column(&reader, &event, &mut worksheet)?,
                b"c" => {
                    let cell =
                        finish_cell(begin_cell(&reader, &event, style_count)?, shared_strings);
                    worksheet.insert(cell);
                }
                b"mergeCell" => apply_merge(&reader, &event, &mut worksheet)?,
                b"pane" => apply_pane(&reader, &event, &mut worksheet)?,
                _ => {}
            },
            Event::Text(text) if capture.is_some() => {
                capture_text.push_str(&decode_text(&text)?);
            }
            Event::CData(text) if capture.is_some() => {
                capture_text.push_str(&decode_cdata(&text)?);
            }
            Event::GeneralRef(reference) if capture.is_some() => {
                capture_text.push_str(&decode_reference(&reference)?);
            }
            Event::End(event) => match event.local_name().as_ref() {
                b"v" if capture == Some(Capture::Value) => {
                    if let Some(cell) = &mut current_cell {
                        cell.value = Some(std::mem::take(&mut capture_text));
                    }
                    capture = None;
                }
                b"f" if capture == Some(Capture::Formula) => {
                    if let Some(cell) = &mut current_cell {
                        let formula = std::mem::take(&mut capture_text);
                        cell.formula = (!formula.is_empty()).then(|| format!("={formula}"));
                    }
                    capture = None;
                }
                b"t" if capture == Some(Capture::Inline) => {
                    if let Some(cell) = &mut current_cell {
                        cell.inline.push_str(&capture_text);
                    }
                    capture_text.clear();
                    capture = None;
                }
                b"c" => {
                    if let Some(cell) = current_cell.take() {
                        worksheet.insert(finish_cell(cell, shared_strings));
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(worksheet)
}

#[derive(Debug, Default)]
struct DrawingAnchor {
    from: DrawingPosition,
    to: Option<DrawingPosition>,
    extent_emu: Option<(u64, u64)>,
    chart_relationship_id: Option<String>,
}

#[derive(Debug, Default)]
struct DrawingPosition {
    column: Option<u32>,
    row: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DrawingPositionKind {
    From,
    To,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DrawingCapture {
    Column,
    Row,
}

fn attach_charts(
    worksheets: &mut [Worksheet],
    sheet_targets: &[String],
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    expanded: &mut u64,
) -> Result<()> {
    for (worksheet_index, worksheet_target) in sheet_targets.iter().enumerate() {
        if worksheet_index >= worksheets.len() {
            break;
        }
        let Some(worksheet_relationships_path) = relationships_part(worksheet_target) else {
            continue;
        };
        let Some(worksheet_relationships_xml) =
            read_optional_part(archive, &worksheet_relationships_path, expanded)?
        else {
            continue;
        };
        let Ok(relationships) = parse_relationships(&worksheet_relationships_xml) else {
            continue;
        };
        let Some(drawing_relationship) = relationships
            .values()
            .find(|relationship| !relationship.external && relationship.kind.ends_with("/drawing"))
        else {
            continue;
        };
        let drawing_path = resolve_part("xl/worksheets", &drawing_relationship.target)?;
        let Some(drawing_xml) = read_optional_part(archive, &drawing_path, expanded)? else {
            continue;
        };
        let Ok(anchors) = parse_drawing_anchors(&drawing_xml) else {
            continue;
        };
        let Some(drawing_relationships_path) = relationships_part(&drawing_path) else {
            continue;
        };
        let Some(drawing_relationships_xml) =
            read_optional_part(archive, &drawing_relationships_path, expanded)?
        else {
            continue;
        };
        let Ok(drawing_relationships) = parse_relationships(&drawing_relationships_xml) else {
            continue;
        };
        for anchor in anchors {
            let Some(chart_relationship_id) = anchor.chart_relationship_id.as_deref() else {
                continue;
            };
            let Some(chart_relationship) = drawing_relationships.get(chart_relationship_id) else {
                continue;
            };
            if chart_relationship.external || !chart_relationship.kind.ends_with("/chart") {
                continue;
            }
            let chart_path = resolve_part("xl/drawings", &chart_relationship.target)?;
            let Some(chart_xml) = read_optional_part(archive, &chart_path, expanded)? else {
                continue;
            };
            let Some((title, points)) = parse_chart_spec(&chart_xml, worksheets) else {
                continue;
            };
            let Some(from) = drawing_position_coord(&anchor.from) else {
                continue;
            };
            let (width, height) = anchor_size(&anchor, &worksheets[worksheet_index]);
            let chart = ChartSpec {
                title,
                subtitle: String::new(),
                anchor: from,
                width,
                height,
                points,
            };
            worksheets[worksheet_index].charts.push(chart);
        }
    }
    Ok(())
}

fn relationships_part(part: &str) -> Option<String> {
    let (directory, file) = part.rsplit_once('/')?;
    Some(format!("{directory}/_rels/{file}.rels"))
}

fn parse_drawing_anchors(xml: &[u8]) -> Result<Vec<DrawingAnchor>> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut anchors = Vec::new();
    let mut current: Option<DrawingAnchor> = None;
    let mut position_kind: Option<DrawingPositionKind> = None;
    let mut capture: Option<DrawingCapture> = None;
    let mut capture_text = String::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(event) => match event.local_name().as_ref() {
                b"oneCellAnchor" | b"twoCellAnchor" => current = Some(DrawingAnchor::default()),
                b"from" => position_kind = Some(DrawingPositionKind::From),
                b"to" => {
                    if let Some(anchor) = &mut current {
                        anchor.to = Some(DrawingPosition::default());
                    }
                    position_kind = Some(DrawingPositionKind::To);
                }
                b"col" => {
                    capture = Some(DrawingCapture::Column);
                    capture_text.clear();
                }
                b"row" => {
                    capture = Some(DrawingCapture::Row);
                    capture_text.clear();
                }
                b"chart" => {
                    if let Some(anchor) = &mut current {
                        anchor.chart_relationship_id = attribute(&reader, &event, b"id")?;
                    }
                }
                b"ext" => {
                    if let Some(anchor) = &mut current {
                        anchor.extent_emu = extent(&reader, &event)?;
                    }
                }
                _ => {}
            },
            Event::Empty(event) => match event.local_name().as_ref() {
                b"chart" => {
                    if let Some(anchor) = &mut current {
                        anchor.chart_relationship_id = attribute(&reader, &event, b"id")?;
                    }
                }
                b"ext" => {
                    if let Some(anchor) = &mut current {
                        anchor.extent_emu = extent(&reader, &event)?;
                    }
                }
                _ => {}
            },
            Event::Text(text) if capture.is_some() => {
                capture_text.push_str(&decode_text(&text)?);
            }
            Event::CData(text) if capture.is_some() => {
                capture_text.push_str(&decode_cdata(&text)?);
            }
            Event::GeneralRef(reference) if capture.is_some() => {
                capture_text.push_str(&decode_reference(&reference)?);
            }
            Event::End(event) => match event.local_name().as_ref() {
                b"col" | b"row" => {
                    if let (Some(kind), Ok(value)) = (capture.take(), capture_text.parse::<u32>())
                        && let (Some(anchor), Some(position_kind)) = (&mut current, position_kind)
                    {
                        let position = match position_kind {
                            DrawingPositionKind::From => &mut anchor.from,
                            DrawingPositionKind::To => {
                                anchor.to.get_or_insert_with(DrawingPosition::default)
                            }
                        };
                        match kind {
                            DrawingCapture::Column => position.column = Some(value),
                            DrawingCapture::Row => position.row = Some(value),
                        }
                    }
                    capture_text.clear();
                }
                b"from" | b"to" => position_kind = None,
                b"oneCellAnchor" | b"twoCellAnchor" => {
                    if let Some(anchor) = current.take() {
                        anchors.push(anchor);
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(anchors)
}

fn extent(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> Result<Option<(u64, u64)>> {
    let Some(width) = attribute(reader, event, b"cx")?.and_then(|value| value.parse().ok()) else {
        return Ok(None);
    };
    let Some(height) = attribute(reader, event, b"cy")?.and_then(|value| value.parse().ok()) else {
        return Ok(None);
    };
    if width == 0 || height == 0 {
        return Ok(None);
    }
    Ok(Some((width, height)))
}

fn drawing_position_coord(position: &DrawingPosition) -> Option<CellCoord> {
    Some(CellCoord::new(position.row?, position.column?))
}

fn anchor_size(anchor: &DrawingAnchor, worksheet: &Worksheet) -> (f32, f32) {
    const EMU_PER_INCH: f32 = 914_400.0;
    const PIXELS_PER_INCH: f32 = 96.0;
    if let Some((width, height)) = anchor.extent_emu {
        return (
            width as f32 * PIXELS_PER_INCH / EMU_PER_INCH,
            height as f32 * PIXELS_PER_INCH / EMU_PER_INCH,
        );
    }
    let Some(to) = anchor.to.as_ref() else {
        return (320.0, 220.0);
    };
    let Some(from) = drawing_position_coord(&anchor.from) else {
        return (320.0, 220.0);
    };
    let Some(to) = drawing_position_coord(to) else {
        return (320.0, 220.0);
    };
    let Some(column_span) = to.column.checked_sub(from.column).map(|value| value + 1) else {
        return (320.0, 220.0);
    };
    let Some(row_span) = to.row.checked_sub(from.row).map(|value| value + 1) else {
        return (320.0, 220.0);
    };
    if column_span > MAX_CHART_ANCHOR_SPAN || row_span > MAX_CHART_ANCHOR_SPAN {
        return (320.0, 220.0);
    }
    let width = (from.column..=to.column)
        .map(|column| worksheet.column_width(column))
        .sum::<f32>();
    let height = (from.row..=to.row)
        .map(|row| worksheet.row_height(row))
        .sum::<f32>();
    (width.max(1.0), height.max(1.0))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChartCapture {
    Title,
    Category,
    Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChartReferenceKind {
    Category,
    Value,
}

#[derive(Debug, Default)]
struct ChartSeries {
    category_reference: Option<String>,
    value_reference: Option<String>,
}

fn parse_chart_spec(xml: &[u8], worksheets: &[Worksheet]) -> Option<(String, Vec<ChartPoint>)> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut title = String::new();
    let mut title_depth = false;
    let mut context = None;
    let mut series = Vec::new();
    let mut current_series: Option<ChartSeries> = None;
    let mut capture = None;
    let mut capture_text = String::new();
    loop {
        match reader.read_event_into(&mut buffer).ok()? {
            Event::Start(event) => match event.local_name().as_ref() {
                b"title" => title_depth = true,
                b"ser" => current_series = Some(ChartSeries::default()),
                b"cat" => context = Some(ChartReferenceKind::Category),
                b"val" => context = Some(ChartReferenceKind::Value),
                b"f" if current_series.is_some() => {
                    capture = match context {
                        Some(ChartReferenceKind::Category) => Some(ChartCapture::Category),
                        Some(ChartReferenceKind::Value) => Some(ChartCapture::Value),
                        None => None,
                    };
                    capture_text.clear();
                }
                b"t" if title_depth => {
                    capture = Some(ChartCapture::Title);
                    capture_text.clear();
                }
                _ => {}
            },
            Event::Text(text) if capture.is_some() => {
                capture_text.push_str(&decode_text(&text).ok()?);
            }
            Event::CData(text) if capture.is_some() => {
                capture_text.push_str(&decode_cdata(&text).ok()?);
            }
            Event::GeneralRef(reference) if capture.is_some() => {
                capture_text.push_str(&decode_reference(&reference).ok()?);
            }
            Event::End(event) => match event.local_name().as_ref() {
                b"f" => {
                    let captured = capture.take();
                    if let Some(value) = (!capture_text.is_empty()).then(|| capture_text.clone())
                        && let Some(series) = &mut current_series
                    {
                        match captured {
                            Some(ChartCapture::Category) => series.category_reference = Some(value),
                            Some(ChartCapture::Value) => series.value_reference = Some(value),
                            _ => {}
                        }
                    }
                    capture_text.clear();
                }
                b"t" if capture == Some(ChartCapture::Title) => {
                    title = capture_text.trim().to_string();
                    capture = None;
                    capture_text.clear();
                }
                b"title" => title_depth = false,
                b"cat" | b"val" => context = None,
                b"ser" => {
                    if let Some(series_item) = current_series.take() {
                        series.push(series_item);
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }

    let series = series.into_iter().next()?;
    let (category_sheet, category_range) = chart_reference(series.category_reference.as_deref()?)?;
    let (value_sheet, value_range) = chart_reference(series.value_reference.as_deref()?)?;
    if category_sheet != value_sheet {
        return None;
    }
    let worksheet = worksheets
        .iter()
        .find(|sheet| sheet.name == category_sheet)?;
    let category_coordinates = range_coordinates(category_range)?;
    let value_coordinates = range_coordinates(value_range)?;
    let points = category_coordinates
        .into_iter()
        .zip(value_coordinates)
        .filter_map(|(label_coord, value_coord)| {
            let label = worksheet.cell(label_coord).map(|cell| match &cell.value {
                CellValue::String(value) | CellValue::Error(value) => value.clone(),
                CellValue::Boolean(value) => value.to_string(),
                CellValue::Number(value) => value.to_string(),
                CellValue::Blank => String::new(),
            })?;
            let value = worksheet.cell(value_coord)?.value.as_number()?;
            Some(ChartPoint { label, value })
        })
        .collect::<Vec<_>>();
    (!points.is_empty()).then(|| {
        (
            if title.is_empty() {
                "Chart".into()
            } else {
                title
            },
            points,
        )
    })
}

fn chart_reference(reference: &str) -> Option<(String, crate::model::MergeRange)> {
    let (sheet, range) = reference.rsplit_once('!')?;
    let sheet = sheet.trim().trim_matches('\'').replace("''", "'");
    Some((sheet, parse_range(range).ok()?))
}

fn range_coordinates(range: crate::model::MergeRange) -> Option<Vec<CellCoord>> {
    let rows = range.end.row.saturating_sub(range.start.row) + 1;
    let columns = range.end.column.saturating_sub(range.start.column) + 1;
    let point_count = u64::from(rows) * u64::from(columns);
    if point_count == 0 || point_count > MAX_CHART_POINTS {
        return None;
    }
    let mut coordinates = Vec::with_capacity((rows as usize).saturating_mul(columns as usize));
    for row in range.start.row..=range.end.row {
        for column in range.start.column..=range.end.column {
            coordinates.push(CellCoord::new(row, column));
        }
    }
    Some(coordinates)
}

fn begin_cell(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    style_count: usize,
) -> Result<CellBuilder> {
    let address = attribute(reader, event, b"r")?
        .ok_or_else(|| GridlineError::Xml("cell is missing its r coordinate".into()))?;
    Ok(CellBuilder {
        coord: parse_address(&address)?,
        cell_type: attribute(reader, event, b"t")?.unwrap_or_else(|| "n".into()),
        style_id: numeric_attribute(reader, event, b"s")?
            .unwrap_or(0)
            .min(style_count.saturating_sub(1) as u32) as usize,
        value: None,
        formula: None,
        inline: String::new(),
    })
}

fn finish_cell(cell: CellBuilder, shared_strings: &[String]) -> Cell {
    let raw = cell.value.unwrap_or_default();
    let value = match cell.cell_type.as_str() {
        "s" => raw
            .parse::<usize>()
            .ok()
            .and_then(|index| shared_strings.get(index))
            .cloned()
            .map(CellValue::String)
            .unwrap_or_else(|| CellValue::Error("#VALUE!".into())),
        "inlineStr" => CellValue::String(cell.inline),
        "str" | "d" => CellValue::String(raw),
        "b" => CellValue::Boolean(parse_bool(&raw)),
        "e" => CellValue::Error(raw),
        _ if raw.is_empty() => CellValue::Blank,
        _ => raw
            .parse::<f64>()
            .map(CellValue::Number)
            .unwrap_or_else(|_| CellValue::String(raw)),
    };
    Cell {
        coord: cell.coord,
        value,
        formula: cell.formula,
        style_id: cell.style_id,
    }
}

fn apply_dimension(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    worksheet: &mut Worksheet,
) -> Result<()> {
    let Some(reference) = attribute(reader, event, b"ref")? else {
        return Ok(());
    };
    let range = parse_range(&reference)?;
    worksheet.max_row = worksheet.max_row.max(range.end.row);
    worksheet.max_column = worksheet.max_column.max(range.end.column);
    Ok(())
}

fn apply_row(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    worksheet: &mut Worksheet,
) -> Result<()> {
    let Some(row) = numeric_attribute(reader, event, b"r")? else {
        return Ok(());
    };
    if row == 0 {
        return Ok(());
    }
    if attribute(reader, event, b"hidden")?.is_some_and(|value| parse_bool(&value)) {
        worksheet.row_heights.insert(row - 1, 0.0);
    } else if let Some(height) =
        attribute(reader, event, b"ht")?.and_then(|value| value.parse::<f32>().ok())
    {
        worksheet
            .row_heights
            .insert(row - 1, points_to_pixels(height));
    }
    Ok(())
}

fn apply_column(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    worksheet: &mut Worksheet,
) -> Result<()> {
    let Some(min) = numeric_attribute(reader, event, b"min")? else {
        return Ok(());
    };
    let max = numeric_attribute(reader, event, b"max")?.unwrap_or(min);
    if min == 0 || max < min {
        return Ok(());
    }
    let width = attribute(reader, event, b"width")?
        .and_then(|value| value.parse::<f32>().ok())
        .map(excel_width_to_pixels)
        .unwrap_or(crate::model::DEFAULT_COLUMN_WIDTH);
    worksheet.column_spans.push(ColumnSpan {
        start: min - 1,
        end: max - 1,
        width,
        hidden: attribute(reader, event, b"hidden")?.is_some_and(|value| parse_bool(&value)),
    });
    Ok(())
}

fn apply_merge(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    worksheet: &mut Worksheet,
) -> Result<()> {
    if let Some(reference) = attribute(reader, event, b"ref")? {
        worksheet.merged_cells.push(parse_range(&reference)?);
    }
    Ok(())
}

fn apply_pane(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    worksheet: &mut Worksheet,
) -> Result<()> {
    let state = attribute(reader, event, b"state")?.unwrap_or_default();
    if state != "frozen" && state != "frozenSplit" {
        return Ok(());
    }
    worksheet.freeze = FreezePane {
        rows: numeric_attribute(reader, event, b"ySplit")?.unwrap_or(0),
        columns: numeric_attribute(reader, event, b"xSplit")?.unwrap_or(0),
        top_left_cell: attribute(reader, event, b"topLeftCell")?,
    };
    Ok(())
}

fn parse_core_title(xml: &[u8]) -> Result<Option<String>> {
    let mut reader = xml_reader(xml);
    let mut buffer = Vec::new();
    let mut in_title = false;
    let mut title = String::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(event) if is_tag(&event, b"title") => in_title = true,
            Event::Text(text) if in_title => title.push_str(&decode_text(&text)?),
            Event::CData(text) if in_title => title.push_str(&decode_cdata(&text)?),
            Event::GeneralRef(reference) if in_title => {
                title.push_str(&decode_reference(&reference)?);
            }
            Event::End(event) if event.local_name().as_ref() == b"title" => break,
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok((!title.trim().is_empty()).then(|| title.trim().to_string()))
}

fn resolve_part(base: &str, target: &str) -> Result<String> {
    if target.contains("://") {
        return Err(GridlineError::Xml(
            "external relationship target rejected".into(),
        ));
    }
    let mut parts = if target.starts_with('/') {
        Vec::new()
    } else {
        base.split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
    };
    let target = target.trim_start_matches('/');
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(GridlineError::Xml(format!(
                        "relationship escapes the OOXML package: {target}"
                    )));
                }
            }
            value => parts.push(value),
        }
    }
    Ok(parts.join("/"))
}

fn xml_reader(xml: &[u8]) -> Reader<&[u8]> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    reader
}

fn is_tag(event: &BytesStart<'_>, name: &[u8]) -> bool {
    event.local_name().as_ref() == name
}

fn attribute(reader: &Reader<&[u8]>, event: &BytesStart<'_>, key: &[u8]) -> Result<Option<String>> {
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| GridlineError::Xml(error.to_string()))?;
        if attribute.key.local_name().as_ref() == key {
            return attribute
                .decode_and_unescape_value(reader.decoder())
                .map(|value| Some(value.into_owned()))
                .map_err(|error| GridlineError::Xml(error.to_string()));
        }
    }
    Ok(None)
}

fn numeric_attribute(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    key: &[u8],
) -> Result<Option<u32>> {
    Ok(attribute(reader, event, key)?.and_then(|value| value.parse().ok()))
}

fn decode_text(text: &BytesText<'_>) -> Result<String> {
    let decoded = text
        .xml_content()
        .map_err(|error| GridlineError::Xml(error.to_string()))?;
    quick_xml::escape::unescape(&decoded)
        .map(|value| value.into_owned())
        .map_err(|error| GridlineError::Xml(error.to_string()))
}

fn decode_cdata(text: &BytesCData<'_>) -> Result<String> {
    text.xml_content()
        .map(|value| value.into_owned())
        .map_err(|error| GridlineError::Xml(error.to_string()))
}

fn decode_reference(reference: &BytesRef<'_>) -> Result<String> {
    let value = reference
        .decode()
        .map_err(|error| GridlineError::Xml(error.to_string()))?;
    if let Some(character) = reference.resolve_char_ref()? {
        return Ok(character.to_string());
    }
    Ok(quick_xml::escape::resolve_predefined_entity(&value)
        .map(str::to_string)
        .unwrap_or_else(|| format!("&{value};")))
}

fn begin_capture(capture: &mut Option<Capture>, buffer: &mut String, value: Capture) {
    *capture = Some(value);
    buffer.clear();
}

fn default_font() -> FontStyle {
    FontStyle {
        family: "Arial".into(),
        size: 11.0,
        bold: false,
        italic: false,
        underline: false,
        color: Some("#171b21".into()),
    }
}

fn leaf_bool(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> Result<bool> {
    Ok(attribute(reader, event, b"val")?
        .map(|value| parse_bool(&value))
        .unwrap_or(true))
}

fn parse_bool(value: &str) -> bool {
    value == "1" || value.eq_ignore_ascii_case("true")
}

fn points_to_pixels(points: f32) -> f32 {
    (points * 96.0 / 72.0).max(0.0)
}

fn excel_width_to_pixels(width: f32) -> f32 {
    ((width * 7.0 + 5.0).floor()).max(0.0)
}

fn built_in_number_format(id: u32) -> &'static str {
    match id {
        0 => "General",
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        14 => "mm/dd/yyyy",
        15 => "d-mmm-yy",
        16 => "d-mmm",
        17 => "mmm-yy",
        18 => "h:mm AM/PM",
        19 => "h:mm:ss AM/PM",
        20 => "h:mm",
        21 => "h:mm:ss",
        22 => "mm/dd/yyyy h:mm",
        37 => "#,##0;(#,##0)",
        38 => "#,##0;[Red](#,##0)",
        39 => "#,##0.00;(#,##0.00)",
        40 => "#,##0.00;[Red](#,##0.00)",
        45 => "mm:ss",
        46 => "[h]:mm:ss",
        47 => "mmss.0",
        49 => "@",
        _ => "General",
    }
}

fn indexed_color(index: u32) -> Option<&'static str> {
    match index {
        0 | 8 => Some("#000000"),
        1 | 9 => Some("#FFFFFF"),
        2 | 10 => Some("#FF0000"),
        3 | 11 => Some("#00FF00"),
        4 | 12 => Some("#0000FF"),
        5 | 13 => Some("#FFFF00"),
        6 | 14 => Some("#FF00FF"),
        7 | 15 => Some("#00FFFF"),
        _ => None,
    }
}

fn theme_color(index: u32) -> &'static str {
    match index {
        0 => "#FFFFFF",
        1 => "#000000",
        2 => "#E7E6E6",
        3 => "#44546A",
        4 => "#4472C4",
        5 => "#ED7D31",
        6 => "#A5A5A5",
        7 => "#FFC000",
        8 => "#5B9BD5",
        9 => "#70AD47",
        _ => "#171B21",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn parses_minimal_styled_workbook() {
        let bytes = fixture_workbook();
        let workbook = parse_workbook(&bytes).unwrap();
        assert_eq!(workbook.title, "Parser fixture");
        assert_eq!(workbook.sheets[0].name, "Summary");
        assert_eq!(
            workbook.sheets[0].cell(CellCoord::new(0, 0)).unwrap().value,
            CellValue::String("Revenue".into())
        );
        assert_eq!(
            workbook.sheets[0].cell(CellCoord::new(2, 2)).unwrap().value,
            CellValue::Number(1250.0)
        );
        assert_eq!(workbook.sheets[0].merged_cells.len(), 1);
        assert_eq!(workbook.sheets[0].freeze.rows, 1);
        assert_eq!(workbook.styles[1].number_format, "$#,##0");
    }

    #[test]
    fn blocks_relationship_escape() {
        assert!(resolve_part("xl", "../../outside.xml").is_err());
        assert_eq!(
            resolve_part("xl", "worksheets/sheet1.xml").unwrap(),
            "xl/worksheets/sheet1.xml"
        );
    }

    #[test]
    fn parses_chart_anchor_and_references() {
        let drawing = br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>17</xdr:row></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:row>35</xdr:row></xdr:to><xdr:graphicFrame><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>"#;
        let anchors = parse_drawing_anchors(drawing).unwrap();
        assert_eq!(anchors.len(), 1);
        assert_eq!(
            drawing_position_coord(&anchors[0].from),
            Some(CellCoord::new(17, 0))
        );
        assert_eq!(
            drawing_position_coord(anchors[0].to.as_ref().unwrap()),
            Some(CellCoord::new(35, 8))
        );
        assert_eq!(
            anchors[0].chart_relationship_id.as_deref(),
            Some("rIdChart")
        );

        let mut dashboard = Worksheet::new("Dashboard");
        dashboard.insert(Cell {
            coord: CellCoord::new(15, 0),
            value: CellValue::String("Base".into()),
            formula: None,
            style_id: 0,
        });
        dashboard.insert(Cell {
            coord: CellCoord::new(15, 1),
            value: CellValue::Number(10.5),
            formula: None,
            style_id: 0,
        });
        let chart = br#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Compute capacity</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:lineChart><c:ser><c:cat><c:strRef><c:f>'Dashboard'!$A$16:$A$16</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>'Dashboard'!$B$16:$B$16</c:f></c:numRef></c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>"#;
        let (title, points) = parse_chart_spec(chart, &[dashboard]).unwrap();
        assert_eq!(title, "Compute capacity");
        assert_eq!(points[0].label, "Base");
        assert_eq!(points[0].value, 10.5);
    }

    #[test]
    fn resolves_chart_reference_with_escaped_sheet_name() {
        let (sheet, range) = chart_reference("'Input''s Data'!$B$2:$B$4").unwrap();
        assert_eq!(sheet, "Input's Data");
        assert_eq!(range.start, CellCoord::new(1, 1));
        assert_eq!(range.end, CellCoord::new(3, 1));
        assert!(range_coordinates(parse_range("A1:XFD1048576").unwrap()).is_none());
    }

    #[test]
    fn decodes_escaped_formula_operators() {
        let worksheet = parse_worksheet(
            br#"<worksheet><sheetData><row r="1"><c r="A1" t="n"><f>IF(1&gt;0,1,0)</f><v>1</v></c></row></sheetData></worksheet>"#,
            "Checks".into(),
            &[],
            1,
        )
        .unwrap();
        assert_eq!(
            worksheet
                .cell(CellCoord::new(0, 0))
                .unwrap()
                .formula
                .as_deref(),
            Some("=IF(1>0,1,0)")
        );
    }

    fn fixture_workbook() -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let parts = [
            (
                "xl/workbook.xml",
                r#"<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            (
                "xl/sharedStrings.xml",
                r#"<?xml version="1.0"?><sst><si><t>Revenue</t></si></sst>"#,
            ),
            (
                "xl/styles.xml",
                r#"<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="165" formatCode="$#,##0"/></numFmts><fonts count="1"><font><name val="Arial"/><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/></border></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf></cellXfs></styleSheet>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<?xml version="1.0"?><worksheet><dimension ref="A1:C3"/><sheetViews><sheetView><pane xSplit="1" ySplit="1" topLeftCell="B2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="20"/></cols><sheetData><row r="1" ht="24"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="B2" s="1"><v>1250</v></c></row><row r="3"><c r="C3" s="1"><f>SUM(B2:B2)</f></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells></worksheet>"#,
            ),
            (
                "docProps/core.xml",
                r#"<?xml version="1.0"?><cp:coreProperties xmlns:cp="core" xmlns:dc="dc"><dc:title>Parser fixture</dc:title></cp:coreProperties>"#,
            ),
        ];
        for (name, body) in parts {
            writer.start_file(name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
}
