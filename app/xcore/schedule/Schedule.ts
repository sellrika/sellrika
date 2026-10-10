/**
 * Background jobs on Bun's built-in scheduler.
 */
export class Schedule {
	/**
	 * Register a cron job and run it once right away.
	 * It runs on Bun's built-in scheduler (`Bun.cron`): in-process,
	 * runs never overlap, and the job is rescheduled after an error.
	 * The boot run catches up on everything missed while the server was down.
	 * A failing run is logged, never fatal.
	 * The expression is the classic 5-field form
	 * (`minute hour day month weekday`), read in UTC.
	 * Every run logs one `[name] run (boot|cron …)` line,
	 * so a schedule that stops firing is visible in the log.
	 * @param name What to call it in the log.
	 * @param expression When to run, e.g. `"* * * * *"` for every minute.
	 * @param job The work.
	 * @returns The job handle. `.stop()` cancels it.
	 */
	static cron(name: string, expression: string, job: () => Promise<unknown>) {
		/**
		 * Run the job once and log how long it took.
		 * @param why What started this run, for the log.
		 */
		async function run(why: string) {
			const t0 = Date.now();
			console.log(`[${name}] run (${why}) at ${new Date(t0).toISOString()}`);
			try {
				await job();
			} catch (e) {
				console.error(`[${name}]`, e);
			}
			console.log(`[${name}] done in ${Date.now() - t0} ms`);
		}
		void run("boot");
		const handle = Bun.cron(expression, () => run(`cron "${expression}"`), {
			tz: "UTC",
		});
		const first = Bun.cron.parse(expression, Date.now(), { tz: "UTC" });
		console.log(
			`[${name}] scheduled "${expression}" (UTC), first fire ${first?.toISOString() ?? "never"}`,
		);
		return handle;
	}
}
