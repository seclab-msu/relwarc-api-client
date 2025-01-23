use std::any::Any;
use std::error::Error;
use std::io;

trait CommonCursor {
    fn get_length(&self) -> u64;
}

impl<T: AsRef<[u8]>> CommonCursor for io::Cursor<T> {
    fn get_length(&self) -> u64 {
        self.get_ref().as_ref().len() as u64 - self.position()
    }
}

fn downcast_cursor<T: 'static, CT: AsRef<[u8]> + 'static>(val: &T) -> Option<&dyn CommonCursor> {
    match (val as &dyn Any).downcast_ref::<io::Cursor<CT>>() {
        Some(c) => Some(c as &dyn CommonCursor),
        None => None,
    }
}

fn downcast_common_cursor<T: 'static>(val: &T) -> Option<&dyn CommonCursor> {
    if let Some(c) = downcast_cursor::<T, Vec<u8>>(val) {
        return Some(c);
    }
    if let Some(c) = downcast_cursor::<T, &Vec<u8>>(val) {
        return Some(c);
    }
    if let Some(c) = downcast_cursor::<T, &mut Vec<u8>>(val) {
        return Some(c);
    }
    if let Some(c) = downcast_cursor::<T, &[u8]>(val) {
        return Some(c);
    }
    if let Some(c) = downcast_cursor::<T, &mut [u8]>(val) {
        return Some(c);
    }
    if let Some(c) = downcast_cursor::<T, Box<[u8]>>(val) {
        return Some(c);
    }
    if let Some(c) = downcast_cursor::<T, &str>(val) {
        return Some(c);
    }
    None
}

pub fn determine_length<T: io::Read + Send + 'static>(
    mut r: T,
) -> Result<(Box<dyn io::Read + Send + 'static>, u64), Box<dyn Error>> {
    if let Some(cursor) = downcast_common_cursor(&r) {
        // impl optimized for std::io::Cursor
        let l = cursor.get_length();
        return Ok((Box::new(r), l));
    }
    if let Some(f) = (&r as &dyn Any).downcast_ref::<std::fs::File>() {
        if let Ok(metadata) = f.metadata() {
            if metadata.is_file() {
                // impl optimized for std::fs::File
                let l = metadata.len();
                return Ok((Box::new(r), l));
            }
        }
    }
    let mut data = Vec::new();

    // generic impl: read to end

    let amount = r.read_to_end(&mut data)?;

    if amount != data.len() {
        panic!(
            "expected an amount of bytes read {} to equal the resulting vector length {}",
            amount,
            data.len()
        );
    }
    Ok((Box::new(io::Cursor::new(data)), amount as u64))
}
