import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
  "recover expired automation leases",
  { minutes: 1 },
  internal.delivery.recover,
  {},
);
export default crons;
