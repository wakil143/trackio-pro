export default {
  async scheduled(controller, env, ctx) {
    if (!env.GITHUB_TOKEN) {
      throw new Error("Missing GITHUB_TOKEN Worker secret.");
    }

    const owner = env.GITHUB_OWNER || "wakil143";
    const repo = env.GITHUB_REPO || "trackio-pro";
    const workflow = env.GITHUB_WORKFLOW || "revision-reminders.yml";
    const ref = env.GITHUB_REF || "main";

    const endpoint =
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Trackio-PRO-Reminder-Cron"
      },
      body: JSON.stringify({ ref })
    });

    if (!response.ok) {
      throw new Error(`GitHub Actions dispatch failed with HTTP ${response.status}`);
    }

    console.log(
      `Dispatched Trackio PRO reminder workflow at ${new Date(controller.scheduledTime).toISOString()}`
    );
  }
};
