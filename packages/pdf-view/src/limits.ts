// Upper bound on PDF byte size accepted by the ingest paths. A ~GB PDF would
// OOM the tab on `file.arrayBuffer()`; reject early with a user-visible error.
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_PDF_BYTES_LABEL = "200 MiB";
