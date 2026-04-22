import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";

export default function LoadingIndicator() {
  return (
    <Box sx={{ maxWidth: "60%", p: 1 }}>
      <Skeleton variant="text" width="80%" height={20} />
      <Skeleton variant="text" width="60%" height={20} />
      <Skeleton variant="text" width="40%" height={20} />
    </Box>
  );
}
