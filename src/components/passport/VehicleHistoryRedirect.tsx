import { Navigate, useLocation, useParams } from "react-router-dom";

export default function VehicleHistoryRedirect() {
  const { slug = "" } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/v/${encodeURIComponent(slug)}${search}${hash}`} replace />;
}
