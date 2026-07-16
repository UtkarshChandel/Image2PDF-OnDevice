use std::fmt;
use std::io::Cursor;

use exif::{In, Reader as ExifReader, Tag};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat, ImageReader, Rgb, RgbImage, RgbaImage};
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

/// Hard safety boundary for browser decoding. The check is performed from the
/// image header before allocating the decoded pixel buffer.
pub const MAX_PIXELS: u64 = 50_000_000;
pub const DEFAULT_JPEG_QUALITY: u8 = 90;
const MIN_JPEG_QUALITY: u8 = 40;
const MAX_JPEG_QUALITY: u8 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoreErrorCode {
    EmptyInput,
    UnsupportedFormat,
    ImageTooLarge,
    DecodeFailed,
    EncodeFailed,
    InvalidQuality,
}

impl CoreErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::EmptyInput => "EMPTY_INPUT",
            Self::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            Self::ImageTooLarge => "IMAGE_TOO_LARGE",
            Self::DecodeFailed => "DECODE_FAILED",
            Self::EncodeFailed => "ENCODE_FAILED",
            Self::InvalidQuality => "INVALID_QUALITY",
        }
    }
}

#[derive(Debug)]
struct CoreError {
    code: CoreErrorCode,
    message: String,
}

impl CoreError {
    fn new(code: CoreErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code.as_str(), self.message)
    }
}

/// A normalized image returned to JavaScript.
///
/// `bytes` is always a complete JPEG file, already oriented and flattened on
/// white, so the PDF layer can pass it directly to `pdfDoc.embedJpg(...)`.
#[derive(Debug)]
#[wasm_bindgen]
pub struct NormalizedImage {
    width: u32,
    height: u32,
    source_format: &'static str,
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl NormalizedImage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    #[wasm_bindgen(getter, js_name = sourceFormat)]
    pub fn source_format(&self) -> String {
        self.source_format.to_owned()
    }

    #[wasm_bindgen(getter)]
    pub fn mime(&self) -> String {
        "image/jpeg".to_owned()
    }

    /// Returns a JavaScript-owned copy. Call `free()` on this object after
    /// embedding the returned bytes in the PDF.
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Uint8Array {
        Uint8Array::from(self.bytes.as_slice())
    }

    #[wasm_bindgen(getter, js_name = byteLength)]
    pub fn byte_length(&self) -> usize {
        self.bytes.len()
    }
}

/// Decode and normalize one browser-selected image.
///
/// Errors are stable strings of the form `ERROR_CODE: human-readable detail`.
/// Keeping the code before the first colon lets the UI map failures onto its
/// state machine without parsing implementation-specific prose.
#[wasm_bindgen]
pub fn normalize_image(bytes: &[u8], jpeg_quality: Option<u8>) -> Result<NormalizedImage, JsValue> {
    normalize_impl(bytes, jpeg_quality.unwrap_or(DEFAULT_JPEG_QUALITY))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn normalize_impl(bytes: &[u8], quality: u8) -> Result<NormalizedImage, CoreError> {
    if bytes.is_empty() {
        return Err(CoreError::new(
            CoreErrorCode::EmptyInput,
            "the selected file has no data",
        ));
    }

    if !(MIN_JPEG_QUALITY..=MAX_JPEG_QUALITY).contains(&quality) {
        return Err(CoreError::new(
            CoreErrorCode::InvalidQuality,
            format!("JPEG quality must be between {MIN_JPEG_QUALITY} and {MAX_JPEG_QUALITY}"),
        ));
    }

    let format = image::guess_format(bytes).map_err(|_| {
        CoreError::new(
            CoreErrorCode::UnsupportedFormat,
            "expected a JPEG, PNG, WebP, TIFF, BMP, or GIF image",
        )
    })?;
    let source_format = supported_format_name(format).ok_or_else(|| {
        CoreError::new(
            CoreErrorCode::UnsupportedFormat,
            format!("the detected {:?} format is not supported", format),
        )
    })?;

    let reader = ImageReader::with_format(Cursor::new(bytes), format);
    let (header_width, header_height) = reader.into_dimensions().map_err(|error| {
        CoreError::new(
            CoreErrorCode::DecodeFailed,
            format!("could not read image dimensions: {error}"),
        )
    })?;
    enforce_pixel_limit(header_width, header_height)?;

    let decoded = ImageReader::with_format(Cursor::new(bytes), format)
        .decode()
        .map_err(|error| {
            CoreError::new(
                CoreErrorCode::DecodeFailed,
                format!("could not decode {source_format}: {error}"),
            )
        })?;

    let oriented = apply_orientation(decoded, read_exif_orientation(bytes));
    let flattened = flatten_on_white(oriented.to_rgba8());
    let (width, height) = flattened.dimensions();

    // Orientation can swap dimensions but cannot increase the pixel count.
    enforce_pixel_limit(width, height)?;

    let mut normalized_bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut normalized_bytes, quality)
        .encode_image(&DynamicImage::ImageRgb8(flattened))
        .map_err(|error| {
            CoreError::new(
                CoreErrorCode::EncodeFailed,
                format!("could not encode normalized JPEG: {error}"),
            )
        })?;

    Ok(NormalizedImage {
        width,
        height,
        source_format,
        bytes: normalized_bytes,
    })
}

fn supported_format_name(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Jpeg => Some("jpeg"),
        ImageFormat::Png => Some("png"),
        ImageFormat::WebP => Some("webp"),
        ImageFormat::Tiff => Some("tiff"),
        ImageFormat::Bmp => Some("bmp"),
        ImageFormat::Gif => Some("gif"),
        _ => None,
    }
}

fn enforce_pixel_limit(width: u32, height: u32) -> Result<(), CoreError> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_PIXELS {
        return Err(CoreError::new(
            CoreErrorCode::ImageTooLarge,
            format!(
                "{width}x{height} is {pixels} pixels; the browser limit is {MAX_PIXELS} pixels"
            ),
        ));
    }
    Ok(())
}

fn read_exif_orientation(bytes: &[u8]) -> u32 {
    let mut cursor = Cursor::new(bytes);
    let Ok(exif) = ExifReader::new().read_from_container(&mut cursor) else {
        return 1;
    };

    exif.get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .filter(|orientation| (1..=8).contains(orientation))
        .unwrap_or(1)
}

fn apply_orientation(image: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        // Transpose across the top-left / bottom-right diagonal.
        5 => image.rotate90().fliph(),
        6 => image.rotate90(),
        // Transpose across the top-right / bottom-left diagonal.
        7 => image.rotate90().flipv(),
        8 => image.rotate270(),
        _ => image,
    }
}

fn flatten_on_white(source: RgbaImage) -> RgbImage {
    let (width, height) = source.dimensions();
    RgbImage::from_fn(width, height, |x, y| {
        let pixel = source.get_pixel(x, y).0;
        let alpha = u16::from(pixel[3]);
        let inverse_alpha = 255 - alpha;
        let blend =
            |channel: u8| ((u16::from(channel) * alpha + 255 * inverse_alpha + 127) / 255) as u8;
        Rgb([blend(pixel[0]), blend(pixel[1]), blend(pixel[2])])
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Frame, GenericImageView, ImageEncoder, Rgba};

    fn png_bytes(image: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                image::ExtendedColorType::Rgba8,
            )
            .expect("test PNG should encode");
        bytes
    }

    fn encoded_test_image(format: ImageFormat) -> Vec<u8> {
        let source = DynamicImage::ImageRgb8(RgbImage::from_fn(3, 2, |x, y| {
            Rgb([(x * 40) as u8, (y * 80) as u8, 120])
        }));
        let mut cursor = Cursor::new(Vec::new());
        source
            .write_to(&mut cursor, format)
            .expect("test image should encode");
        cursor.into_inner()
    }

    fn jpeg_with_orientation(orientation: u16) -> Vec<u8> {
        let jpeg = encoded_test_image(ImageFormat::Jpeg);
        assert_eq!(&jpeg[..2], &[0xff, 0xd8]);

        // A minimal little-endian TIFF with one SHORT Orientation entry,
        // wrapped in a JPEG APP1 Exif segment.
        let mut payload = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
        payload.extend_from_slice(&orientation.to_le_bytes());
        payload.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        let segment_length = u16::try_from(payload.len() + 2).unwrap();

        let mut result = Vec::with_capacity(jpeg.len() + payload.len() + 4);
        result.extend_from_slice(&jpeg[..2]);
        result.extend_from_slice(&[0xff, 0xe1]);
        result.extend_from_slice(&segment_length.to_be_bytes());
        result.extend_from_slice(&payload);
        result.extend_from_slice(&jpeg[2..]);
        result
    }

    fn two_frame_gif() -> Vec<u8> {
        let first = Frame::new(RgbaImage::from_pixel(2, 1, Rgba([240, 10, 10, 255])));
        let second = Frame::new(RgbaImage::from_pixel(2, 1, Rgba([10, 10, 240, 255])));
        let mut bytes = Vec::new();
        image::codecs::gif::GifEncoder::new(&mut bytes)
            .encode_frames([first, second])
            .expect("test GIF should encode");
        bytes
    }

    #[test]
    fn normalizes_png_to_embeddable_jpeg() {
        let source = RgbaImage::from_pixel(3, 2, Rgba([20, 40, 60, 255]));
        let result = normalize_impl(&png_bytes(&source), 90).expect("normalization should succeed");

        assert_eq!((result.width, result.height), (3, 2));
        assert_eq!(result.source_format, "png");
        assert_eq!(
            image::guess_format(&result.bytes).unwrap(),
            ImageFormat::Jpeg
        );
    }

    #[test]
    fn decodes_every_supported_source_format() {
        let cases = [
            (ImageFormat::Jpeg, "jpeg"),
            (ImageFormat::Png, "png"),
            (ImageFormat::WebP, "webp"),
            (ImageFormat::Tiff, "tiff"),
            (ImageFormat::Bmp, "bmp"),
            (ImageFormat::Gif, "gif"),
        ];

        for (format, expected_name) in cases {
            let result = normalize_impl(&encoded_test_image(format), 85)
                .unwrap_or_else(|error| panic!("{expected_name} failed: {error}"));
            assert_eq!(result.source_format, expected_name);
            assert_eq!((result.width, result.height), (3, 2));
            assert_eq!(
                image::guess_format(&result.bytes).unwrap(),
                ImageFormat::Jpeg
            );
        }
    }

    #[test]
    fn reads_and_applies_exif_orientation() {
        let result =
            normalize_impl(&jpeg_with_orientation(6), 90).expect("oriented JPEG should normalize");

        assert_eq!(read_exif_orientation(&jpeg_with_orientation(6)), 6);
        assert_eq!((result.width, result.height), (2, 3));
    }

    #[test]
    fn animated_gif_uses_first_frame() {
        let result = normalize_impl(&two_frame_gif(), 100).expect("animated GIF should normalize");
        let output = image::load_from_memory_with_format(&result.bytes, ImageFormat::Jpeg)
            .expect("normalized JPEG should decode")
            .to_rgb8();
        let pixel = output.get_pixel(0, 0).0;

        assert_eq!(result.source_format, "gif");
        assert!(pixel[0] > 200, "expected red first frame, got {pixel:?}");
        assert!(pixel[2] < 50, "expected red first frame, got {pixel:?}");
    }

    #[test]
    fn alpha_is_flattened_on_white() {
        let source = RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 128]));
        let flattened = flatten_on_white(source);

        assert_eq!(flattened.get_pixel(0, 0).0, [255, 127, 127]);
    }

    #[test]
    fn all_exif_orientations_have_expected_dimensions() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(3, 2, |x, y| {
            Rgba([(x + y * 3) as u8, 0, 0, 255])
        }));

        for orientation in 1..=4 {
            assert_eq!(
                apply_orientation(source.clone(), orientation).dimensions(),
                (3, 2)
            );
        }
        for orientation in 5..=8 {
            assert_eq!(
                apply_orientation(source.clone(), orientation).dimensions(),
                (2, 3)
            );
        }
    }

    #[test]
    fn orientation_five_transposes_pixels() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(3, 2, |x, y| {
            Rgba([(x + y * 3) as u8, 0, 0, 255])
        }));
        let transposed = apply_orientation(source, 5).to_rgba8();

        assert_eq!(transposed.dimensions(), (2, 3));
        assert_eq!(transposed.get_pixel(0, 0).0[0], 0);
        assert_eq!(transposed.get_pixel(1, 0).0[0], 3);
        assert_eq!(transposed.get_pixel(0, 2).0[0], 2);
    }

    #[test]
    fn rejects_more_than_fifty_megapixels() {
        let error = enforce_pixel_limit(10_000, 5_001).unwrap_err();
        assert_eq!(error.code, CoreErrorCode::ImageTooLarge);
        assert!(error.to_string().starts_with("IMAGE_TOO_LARGE:"));
    }

    #[test]
    fn accepts_exactly_fifty_megapixels() {
        enforce_pixel_limit(10_000, 5_000).expect("the documented boundary is inclusive");
    }

    #[test]
    fn rejects_invalid_quality_before_decoding() {
        let error = normalize_impl(b"not an image", 20).unwrap_err();
        assert_eq!(error.code, CoreErrorCode::InvalidQuality);
    }

    #[test]
    fn empty_input_has_stable_error_code() {
        let error = normalize_impl(&[], DEFAULT_JPEG_QUALITY).unwrap_err();
        assert_eq!(error.code, CoreErrorCode::EmptyInput);
        assert!(error.to_string().starts_with("EMPTY_INPUT:"));
    }
}
