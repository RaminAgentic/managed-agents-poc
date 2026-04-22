import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";

interface JsonBlockProps {
  /** Raw JSON string from the server, or a pre-parsed object. */
  value: string | Record<string, unknown> | null | undefined;
  label?: string;
}

/**
 * Renders a JSON payload as pretty-printed, syntax-highlighted monospace text.
 * Handles truncated payloads (server-side 100KB cap) gracefully.
 */
export default function JsonBlock({ value, label }: JsonBlockProps) {
  if (value === null || value === undefined) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
        No data
      </Typography>
    );
  }

  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    // Not valid JSON — show raw text
    parsed = value;
  }

  // Detect truncated payloads from the server
  const isTruncated =
    typeof parsed === "object" &&
    parsed !== null &&
    "_truncated" in (parsed as Record<string, unknown>);

  const formatted =
    typeof parsed === "string"
      ? parsed
      : JSON.stringify(parsed, null, 2);

  return (
    <Box>
      {label && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600, mb: 0.5, display: "block" }}
        >
          {label}
        </Typography>
      )}
      {isTruncated && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 1, py: 0 }}>
          Output was truncated (exceeded 100KB)
        </Alert>
      )}
      <Box
        component="pre"
        sx={{
          fontFamily: "'Fira Code', 'Consolas', monospace",
          fontSize: "0.8rem",
          bgcolor: "grey.50",
          border: 1,
          borderColor: "grey.200",
          borderRadius: 1,
          p: 1.5,
          m: 0,
          overflow: "auto",
          maxHeight: 320,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {formatted}
      </Box>
    </Box>
  );
}
