// The private bucket every vehicle document lands in, and the one size cap
// that governs it.
//
// save-owners-manual used to carry its own 60 MB cap while the bucket was
// created at 25 MB, so a manual between the two passed the function's check
// and then failed at upload with an opaque storage error. The number lives
// here now and the bucket is set to match in
// 20260728220000_vehicle_document_service_role.sql — change both together.

export const VEHICLE_DOCS_BUCKET = "vehicle-docs";

/** 60 MB. Owner's manuals for current models genuinely run 30-50 MB. */
export const VEHICLE_DOCS_MAX_BYTES = 60 * 1024 * 1024;
