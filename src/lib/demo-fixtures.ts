/**
 * The customer whose seeded thread carries a brief older than the thread's own
 * last activity, on purpose.
 *
 * Nina Caldwell's thread takes a staff note after its brief is written, so the
 * inbox marks her badges `earlier brief` and the header counts her as unbriefed.
 * That is the state docs/demo-script.md points at, and the scheduled sweep in
 * /api/ai/sweep leaves the thread alone so it survives the whole day rather than
 * a window each morning.
 *
 * Keyed on the phone rather than on the conversation subject, because the phone
 * is the fixture's real identity: it is unique and non-null, and 555-01xx is
 * reserved for fiction, so the exclusion cannot match a thread a real dealership
 * typed. A subject is free text a real advisor could write by hand.
 *
 * Lives here rather than in demo-seed so a cron route can name the fixture
 * without pulling the seed and its password hashing into its bundle. The seed
 * builds the customer from this same value, so the two cannot drift apart.
 */
export const demoStaleBriefCustomerPhone = "+15125550102";
