import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("recover notification deliveries", { minutes: 1 }, internal.notify.recover, {});
crons.interval("expire stale requests", { hours: 1 }, internal.loans.expireStale, {});

export default crons;
