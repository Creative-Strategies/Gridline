use thiserror::Error;

#[derive(Debug, Error)]
pub enum GridlineError {
    #[error("invalid XLSX archive: {0}")]
    Archive(String),
    #[error("invalid OOXML document: {0}")]
    Xml(String),
    #[error("missing workbook part: {0}")]
    MissingPart(String),
    #[error("sheet index {0} is out of range")]
    SheetOutOfRange(usize),
    #[error("invalid cell address: {0}")]
    InvalidAddress(String),
    #[error("workbook exceeds resource limit: {0}")]
    ResourceLimit(String),
    #[error("serialization failed: {0}")]
    Serialization(String),
}

impl From<zip::result::ZipError> for GridlineError {
    fn from(value: zip::result::ZipError) -> Self {
        Self::Archive(value.to_string())
    }
}

impl From<quick_xml::Error> for GridlineError {
    fn from(value: quick_xml::Error) -> Self {
        Self::Xml(value.to_string())
    }
}

impl From<std::io::Error> for GridlineError {
    fn from(value: std::io::Error) -> Self {
        Self::Archive(value.to_string())
    }
}

pub type Result<T> = std::result::Result<T, GridlineError>;
