const admin = require("firebase-admin");
const crypto = require("node:crypto");

const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!rawCredentials) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON GitHub secret.");

const serviceAccount = JSON.parse(rawCredentials);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const messaging = admin.messaging();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

function asMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

function eventId(uid, chapterId, kind, dueAt) {
  return crypto.createHash("sha256")
    .update([uid, chapterId, kind, String(dueAt)].join("|"))
    .digest("hex");
}

function formatDue(timestamp) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

async function sendDueEvent(uid, chapter, examName, subjectName, kind, dueAt, tokens, stats) {
  if (!dueAt) { stats.invalidDueDates++; return false; }
  stats.candidates++;
  if (dueAt > now) { stats.notYetDue++; return false; }
  stats.dueNow++;

  const id = eventId(uid, chapter.id || chapter.name || "chapter", kind, dueAt);
  const stateRef = db.collection("users").doc(uid)
    .collection("notificationDeliveries").doc(id);

  const alreadySent = await stateRef.get();
  if (alreadySent.exists && alreadySent.data()?.sentAt) { stats.duplicatesSkipped++; return false; }

  const labels = {
    active_recall_2: {
      title: "Trackio PRO • Active Recall 2 due",
      body: `${chapter.name} — ${subjectName} (${examName}). Your second active recall is ready.`
    },
    active_recall_3: {
      title: "Trackio PRO • Active Recall 3 due",
      body: `${chapter.name} — ${subjectName} (${examName}). Your third active recall is ready.`
    },
    weekly_revision: {
      title: "Trackio PRO • Weekly revision due",
      body: `${chapter.name} — ${subjectName} (${examName}). Your spaced revision is due now.`
    }
  };
  const message = labels[kind];
  const tag = `trackio-${id.slice(0, 24)}`;
  let successCount = 0;

  for (const tokenDoc of tokens) {
    const tokenData = tokenDoc.data() || {};
    const token = tokenData.token;
    if (!token || tokenData.enabled === false) continue;

    try {
      await messaging.send({
        token,
        data: {
          title: message.title,
          body: message.body,
          url: "https://wakil143.github.io/trackio-pro/v2/",
          tag,
          kind,
          dueAt: String(dueAt),
          dueLabel: formatDue(dueAt)
        },
        webpush: {
          headers: { TTL: "86400", Urgency: "high" }
        }
      });
      successCount++;
    } catch (error) {
      const code = error && error.code;
      console.error("FCM send failed:", uid, tokenDoc.id, code || error.message);
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token") {
        await tokenDoc.ref.set({
          enabled: false,
          disabledAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }
  }

  if (successCount > 0) {
    stats.successfulDevices += successCount;
    await stateRef.set({
      kind,
      chapterId: chapter.id || "",
      chapterName: chapter.name || "Chapter",
      examName,
      subjectName,
      dueAt,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      successCount
    });
    console.log("SENT", kind, chapter.name, "to", successCount, "device(s)");
    return true;
  }
  return false;
}

async function main() {
  const usersSnapshot = await db.collection("users").get();
  const testPush = process.env.TEST_PUSH === "true";
  const testUid = (process.env.TEST_USER_UID || "").trim();
  if (testPush && !testUid) throw new Error("Enter TEST_USER_UID when running a test push.");
  let sentEvents = 0;
  let testDevices = 0;
  const stats = {
    usersScanned: 0, usersWithActiveTokens: 0, activeTokens: 0,
    examsScanned: 0, subjectsScanned: 0, chaptersScanned: 0,
    skippedMissingAppState: 0, skippedMissingChapters: 0,
    skippedMissingStages: 0, skippedMissingStageTimestamps: 0,
    missingRecall1Timestamp: 0, missingRecall2Timestamp: 0,
    candidates: 0, dueNow: 0, notYetDue: 0, invalidDueDates: 0,
    duplicatesSkipped: 0, successfulDevices: 0
  };

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    if (testPush && uid !== testUid) continue;
    stats.usersScanned++;
    const userData = userDoc.data() || {};
    const examsData = userData.examsData || {};
    const examsList = Array.isArray(userData.examsList) ? userData.examsList : [];

    const tokenSnapshot = await userDoc.ref.collection("fcmTokens")
      .where("enabled", "==", true).get();
    const tokens = tokenSnapshot.docs.filter(doc => doc.data()?.token);
    if (tokens.length === 0) continue;
    stats.usersWithActiveTokens++;
    stats.activeTokens += tokens.length;

    if (testPush) {
      for (const tokenDoc of tokens) {
        try {
          await messaging.send({
            token: tokenDoc.data().token,
            data: {
              title: "Trackio PRO Scheduler Test",
              body: "Server-side FCM is connected. Automatic revision reminders are ready for due-date testing.",
              url: "https://wakil143.github.io/trackio-pro/v2/",
              tag: "trackio-scheduler-test"
            },
            webpush: { headers: { TTL: "300", Urgency: "high" } }
          });
          testDevices++;
        } catch (error) {
          console.error("Scheduler test push failed:", uid, tokenDoc.id, error.code || error.message);
        }
      }
      continue;
    }

    for (const [examId, exam] of Object.entries(examsData)) {
      stats.examsScanned++;
      if (!exam || !exam.appState) { stats.skippedMissingAppState++; continue; }
      const examName = examsList.find(item => item.id === examId)?.name || "Exam";

      for (const subject of Object.values(exam.appState)) {
        if (!subject || !Array.isArray(subject.chapters)) { stats.skippedMissingChapters++; continue; }
        stats.subjectsScanned++;
        const subjectName = subject.name || "Subject";

        for (const chapter of subject.chapters) {
          stats.chaptersScanned++;
          if (!chapter || !chapter.stages) { stats.skippedMissingStages++; continue; }
          if (!chapter.stageTimestamps) { stats.skippedMissingStageTimestamps++; continue; }
          const stages = chapter.stages;
          const times = chapter.stageTimestamps;
          const chapterId = chapter.id || chapter.name || "chapter";
          if (stages.s_active_recall_check && !asMillis(times.s_active_recall_check)) stats.missingRecall1Timestamp++;
          if (stages.s_active_recall_2 && !asMillis(times.s_active_recall_2)) stats.missingRecall2Timestamp++;

          if (stages.s_active_recall_check && !stages.s_active_recall_2) {
            const dueAt = asMillis(times.s_active_recall_check) + DAY;
            if (await sendDueEvent(uid, { ...chapter, id: chapterId }, examName, subjectName, "active_recall_2", dueAt, tokens, stats)) sentEvents++;
          }

          if (stages.s_active_recall_2 && !stages.s_active_recall_3) {
            const dueAt = asMillis(times.s_active_recall_2) + (3 * DAY);
            if (await sendDueEvent(uid, { ...chapter, id: chapterId }, examName, subjectName, "active_recall_3", dueAt, tokens, stats)) sentEvents++;
          }

          if (stages.s_active_recall_check) {
            const dueAt = asMillis(chapter.nextDueTimestamp) ||
              (asMillis(chapter.lastRevisedTimestamp) || asMillis(times.s_active_recall_check)) + (7 * DAY);
            if (await sendDueEvent(uid, { ...chapter, id: chapterId }, examName, subjectName, "weekly_revision", dueAt, tokens, stats)) sentEvents++;
          }
        }
      }
    }
  }

  if (testPush) {
    if (testDevices === 0) throw new Error("No active FCM token accepted the scheduler test push for TEST_USER_UID.");
    console.log(`Scheduler test push accepted by ${testDevices} device token(s). No reminder state was changed.`);
    return;
  }

  console.log("Reminder scan diagnostics (aggregate only):", JSON.stringify({ ...stats, sentEvents }));
  console.log(`Reminder scan complete. Sent ${sentEvents} due event(s).`);
}

main().then(() => process.exit(0)).catch(error => {
  console.error("Reminder scheduler failed:", error);
  process.exit(1);
});
