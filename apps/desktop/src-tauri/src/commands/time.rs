// Civil-calendar timestamp helpers shared by metrics events and apply
// backup naming. Kept dependency-free per the offline-first, minimal-deps
// stance — `chrono` is intentionally not pulled.
//
// Algorithm: Howard Hinnant's `civil_from_days`
// (https://howardhinnant.github.io/date_algorithms.html), adapted to i64
// seconds since the Unix epoch.

use std::time::{SystemTime, UNIX_EPOCH};

// `<YYYY>-<MM>-<DD>T<HH>:<MI>:<SS>.<ms>Z`. Used by metrics so consecutive
// events within the same wall-second still order correctly on disk.
pub(crate) fn now_iso_millis() -> String {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs() as i64;
    let ms = dur.subsec_millis();
    let (y, mo, d, h, mi, s) = civil_from_seconds(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z")
}

// `<YYYY>-<MM>-<DD>T<HH>:<MI>:<SS>Z`. Used by apply for the `applied_at`
// stamp in backup metadata where ms-level precision is noise.
pub(crate) fn now_iso_seconds() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = civil_from_seconds(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn civil_from_seconds(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let h = (rem / 3600) as u32;
    let mi = ((rem % 3600) / 60) as u32;
    let s = (rem % 60) as u32;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (y + if mo <= 2 { 1 } else { 0 }) as i32;
    (y, mo, d, h, mi, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn millis_format_matches_iso_with_subsecond() {
        let s = now_iso_millis();
        // YYYY-MM-DDTHH:MM:SS.mmmZ — 24 chars
        assert_eq!(s.len(), 24, "got {s}");
        assert!(s.ends_with('Z'));
        assert_eq!(s.as_bytes()[10], b'T');
        assert_eq!(s.as_bytes()[19], b'.');
    }

    #[test]
    fn seconds_format_matches_iso_no_subsecond() {
        let s = now_iso_seconds();
        // YYYY-MM-DDTHH:MM:SSZ — 20 chars
        assert_eq!(s.len(), 20, "got {s}");
        assert!(s.ends_with('Z'));
        assert_eq!(s.as_bytes()[10], b'T');
    }

    #[test]
    fn civil_epoch_is_1970_01_01() {
        let (y, mo, d, h, mi, s) = civil_from_seconds(0);
        assert_eq!((y, mo, d, h, mi, s), (1970, 1, 1, 0, 0, 0));
    }

    #[test]
    fn civil_handles_known_leap_day() {
        // 2024-02-29T12:34:56Z — leap day in a year divisible by 4 but not by
        // 100. Catches the era / yoe arithmetic.
        let secs: i64 = 1_709_210_096;
        let (y, mo, d, h, mi, s) = civil_from_seconds(secs);
        assert_eq!((y, mo, d, h, mi, s), (2024, 2, 29, 12, 34, 56));
    }
}
