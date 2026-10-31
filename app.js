
/* Thulirvi LMS frontend. All privileged operations are protected by SQL/RLS. */

const cfg = window.THULIRVI_CONFIG || {};
const configured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_URL.startsWith("https://") &&
  !cfg.SUPABASE_URL.includes("PASTE_") &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

const $ = id => document.getElementById(id);

let sb, user, profile;
let courses = [], enrollments = [];

const esc = v =>
  String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const money = n =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(n || 0));

const say = (target, t, bad = false) => {
  const el = typeof target === "string" ? $(target) : target;
  if (el) {
    el.textContent = t || "";
    el.style.color = bad ? "#b42318" : "var(--teal)";
  }
};

const safeUrl = s => {
  try {
    const u = new URL(s);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};

const dateLabel = d =>
  d ? new Date(d).toLocaleDateString("en-IN") : "No due date";


function renderLessonContent(raw) {
  const text = String(raw || "");

  const parts = text.split(
    /\n(?=(?:EXPLANATION|EXAMPLES|EXPECTED OUTPUT)\s*:)/i
  );

  if (parts.length === 1) {
    return `
      <div class="explanation">
        <h4>📘 Explanation & examples</h4>
        <p>${esc(text).replace(/\n/g, "<br>")}</p>
      </div>`;
  }

  return parts.map(part => {
    const m = part.match(
      /^(EXPLANATION|EXAMPLES|EXPECTED OUTPUT)\s*:?\s*/i
    );

    const label = m ? m[1].toUpperCase() : "LESSON";
    const body = m ? part.slice(m[0].length) : part;

    const title =
      label === "EXPLANATION"
        ? "📘 Topic explanation"
        : label === "EXAMPLES"
        ? "💡 Examples"
        : "🖥️ Expected output";

    return `
      <div class="explanation">
        <h4>${title}</h4>
        <p>${esc(body).replace(/\n/g, "<br>")}</p>
      </div>`;
  }).join("");
}


function showAuth() {
  $("authView").hidden = false;
  $("appView").hidden = true;
  $("logoutBtn").hidden = true;
  $("userEmail").textContent = "";
}


function showApp() {
  $("authView").hidden = true;
  $("appView").hidden = false;
  $("logoutBtn").hidden = false;

  $("userEmail").textContent = user?.email || "";

  $("hello").textContent = profile?.full_name
    ? `Welcome, ${profile.full_name}`
    : "My dashboard";

  $("roleBadge").textContent =
    (profile?.role || "student").toUpperCase();

  $("adminView").hidden = profile?.role !== "admin";
}


async function init() {
  if (!configured) {
    $("configWarning").hidden = false;
    return;
  }

  $("configWarning").hidden = true;

  sb = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  const { data: { session } } = await sb.auth.getSession();

  if (session) {
    user = session.user;
    await afterLogin();
  } else {
    showAuth();
  }

  sb.auth.onAuthStateChange((_e, s) => {
    setTimeout(async () => {
      user = s?.user || null;

      if (user) {
        await afterLogin();
      } else {
        profile = null;
        courses = [];
        enrollments = [];
        showAuth();
      }
    }, 0);
  });
}


async function afterLogin() {
  const { data: p, error } = await sb
    .from("profiles")
    .select("id,full_name,role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !p) {
    showApp();
    say(
      "globalMsg",
      "Profile could not load. Confirm schema.sql ran successfully and profile trigger is installed.",
      true
    );
    return;
  }

  profile = p;

  showApp();

  await loadCourses();
  await loadEnrollments();
  await loadAssignments();
  await loadQuizzes();

  if (profile.role === "admin") {
    await loadPending();
    await loadAdminCourses();
    await loadSubmissions();
    await loadQuizBank();
    await loadStudents();
  }
}


async function loadCourses() {
  const { data, error } = await sb
    .from("courses")
    .select("id,title,description,price_inr,duration_days,is_published")
    .eq("is_published", true)
    .order("title");

  if (error) {
    ["payCourse", "lessonCourse", "assignmentCourse", "quizCourse"]
      .forEach(id => {
        if ($(id)) $(id).innerHTML = "";
      });

    say(
      "globalMsg",
      "Course list unavailable. Check Supabase connection and database access.",
      true
    );

    return;
  }

  courses = data || [];

  const opts = courses.map(c =>
    `<option value="${c.id}">${esc(c.title)} · ${money(c.price_inr)}</option>`
  ).join("");

  ["payCourse", "lessonCourse", "assignmentCourse", "quizCourse"]
    .forEach(id => {
      if ($(id)) $(id).innerHTML = opts;
    });
}


async function loadEnrollments() {
  const { data, error } = await sb
    .from("enrollments")
    .select("id,course_id,status,started_at,courses(id,title,description)")
    .eq("student_id", user.id)
    .order("started_at", { ascending: false });

  if (error) {
    $("myCourses").innerHTML =
      '<p class="empty">Could not load course access.</p>';

    const panel = $("paymentPanel");
    if (panel) panel.hidden = true;

    return;
  }

  enrollments = data || [];

  let totalDone = 0;
  let totalLessons = 0;

  const cards = [];

  for (const e of enrollments) {
    const title = e.courses?.title || "Course";

    if (e.status !== "active") {
      cards.push(`
        <article class="course">
          <h3>${esc(title)}</h3>
          <span class="tag">ACCESS REVOKED</span>
        </article>
      `);
      continue;
    }

    const { data: ls, error: le } = await sb
      .from("lessons")
      .select("id,day_number,title,content,resource_url,task_instructions")
      .eq("course_id", e.course_id)
      .eq("is_published", true)
      .order("day_number");

    if (le) {
      cards.push(`
        <article class="course">
          <h3>${esc(title)}</h3>
          <p>Could not load lessons.</p>
        </article>
      `);
      continue;
    }

    const { data: done } = await sb
      .from("lesson_completions")
      .select("lesson_id")
      .eq("enrollment_id", e.id);

    const completed = new Set(
      (done || []).map(x => x.lesson_id)
    );

    totalDone += completed.size;
    totalLessons += (ls || []).length;

    const elapsed = Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(e.started_at).getTime()) / 86400000
      )
    );

    const unlock = elapsed + 1;

    const lessonHtml = (ls || []).map(l => {
      const open = l.day_number <= unlock;
      const finished = completed.has(l.id);
      const href = safeUrl(l.resource_url);

      return `
        <article class="lesson ${open ? "" : "locked"}">
          <div class="sectionTitle">
            <h3>Day ${l.day_number}: ${esc(l.title)}</h3>
            <span class="tag">
              ${finished ? "COMPLETED" : open ? "UNLOCKED" : "🔒 LOCKED"}
            </span>
          </div>

          ${open ? `
            <div class="lesson-content">
              ${renderLessonContent(l.content)}
            </div>

            ${href ? `
              <p>
                <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">
                  Open resource ↗
                </a>
              </p>
            ` : ""}

            <div class="taskBox">
              <b>🧩 Today's unique task</b>
              <p>
                ${esc(
                  l.task_instructions ||
                  "Task not published yet. Please contact the course admin."
                )}
              </p>
            </div>

            ${!finished ? `
              <button
                class="btn"
                data-complete="${l.id}"
                data-enroll="${e.id}"
              >
                Mark lesson complete
              </button>
            ` : ""}
          ` : `
            <p>
              This lesson unlocks on Day ${l.day_number},
              based on your enrollment start date.
            </p>
          `}
        </article>
      `;
    }).join("");

    const percent = (ls || []).length
      ? Math.round(completed.size / ls.length * 100)
      : 0;

    cards.push(`
      <article class="course">
        <h3>${esc(title)}</h3>

        <p class="fine">Started ${dateLabel(e.started_at)}</p>

        <p>${percent}% lesson progress</p>

        <div class="progress">
          <span style="width:${percent}%"></span>
        </div>

        ${lessonHtml || '<p class="empty">Lessons are being prepared.</p>'}
      </article>
    `);
  }

  $("myCourses").innerHTML = cards.length
    ? cards.join("")
    : `
      <p class="empty">
        You have no enrollments yet.
        Submit a payment claim below; access starts after admin approval.
      </p>
    `;

  $("myCourses").querySelectorAll("[data-complete]")
    .forEach(b => {
      b.onclick = async () => {
        b.disabled = true;

        const { error } = await sb
          .from("lesson_completions")
          .insert({
            enrollment_id: b.dataset.enroll,
            lesson_id: b.dataset.complete,
            student_id: user.id
          });

        if (error && error.code !== "23505") {
          alert("Could not save progress: " + error.message);
        }

        await loadEnrollments();
      };
    });

  $("statCourses").textContent =
    enrollments.filter(e => e.status === "active").length;

  $("statDone").textContent = totalDone;

  // Refresh payment options whenever enrollment data changes.
  await loadPaymentOptions();
}


/*
  PAYMENT FORM FIX

  Hide payment form for:
  1. Active enrollments
  2. Pending payment claims
  3. Approved payment claims

  Rejected payment claims are not blocked, so students can submit again.
*/

async function loadPaymentOptions() {
  const panel = $("paymentPanel");

  if (!panel) return;

  if (profile?.role === "admin") {
    panel.hidden = true;
    return;
  }

  const activeIds = new Set(
    enrollments
      .filter(e => e.status === "active")
      .map(e => e.course_id)
  );

  const { data: claims, error } = await sb
    .from("payments")
    .select("course_id,status")
    .eq("student_id", user.id)
    .in("status", ["pending", "approved"]);

  if (error) {
    panel.hidden = true;

    say(
      "payMsg",
      "Unable to check payment status. Please refresh and try again.",
      true
    );

    return;
  }

  const blockedIds = new Set(
    (claims || []).map(p => p.course_id)
  );

  const available = courses.filter(c =>
    !activeIds.has(c.id) &&
    !blockedIds.has(c.id)
  );

  if (!available.length) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;

  $("payCourse").innerHTML = available.map(c =>
    `<option value="${c.id}">${esc(c.title)} · ${money(c.price_inr)}</option>`
  ).join("");

  $("payAmount").value = available[0].price_inr;

  $("payCourse").onchange = () => {
    const selected = available.find(
      c => c.id === $("payCourse").value
    );

    $("payAmount").value = selected?.price_inr ?? "";
  };
}


async function loadPending() {
  const { data, error } = await sb
    .from("payments")
    .select("id,student_id,course_id,amount_inr,transaction_ref,submitted_at,status,courses(title)")
    .eq("status", "pending")
    .order("submitted_at");

  if (error) {
    $("pendingPayments").innerHTML =
      '<p class="empty">Could not load payments.</p>';
    return;
  }

  $("pendingPayments").innerHTML = data?.length
    ? data.map(p => `
      <article class="payment">
        <b>${esc(p.courses?.title || "Course")}</b>

        <p class="fine">
          Student UUID: ${esc(p.student_id)}<br>
          Submitted: ${dateLabel(p.submitted_at)}<br>
          Amount: ${money(p.amount_inr)}<br>
          UTR: ${esc(p.transaction_ref)}
        </p>

        <div class="actions">
          <button
            class="btn"
            data-review="${p.id}"
            data-status="approved"
          >
            Approve & grant access
          </button>

          <button
            class="btn danger"
            data-review="${p.id}"
            data-status="rejected"
          >
            Reject
          </button>
        </div>
      </article>
    `).join("")
    : '<p class="empty">No pending payment requests.</p>';

  $("pendingPayments").querySelectorAll("[data-review]")
    .forEach(b => {
      b.onclick = async () => {
        if (!confirm(
          `Confirm ${b.dataset.status}? Verify actual credit in your bank/UPI app first.`
        )) return;

        b.disabled = true;

        const { error } = await sb.rpc("admin_review_payment", {
          p_payment_id: b.dataset.review,
          p_new_status: b.dataset.status
        });

        if (error) {
          alert(error.message);
          b.disabled = false;
          return;
        }

        await loadPending();
        await loadEnrollments();
      };
    });
}


async function loadAdminCourses() {
  const { data, error } = await sb
    .from("courses")
    .select("id,title,price_inr,is_published,duration_days")
    .order("created_at", { ascending: false });

  if (error) {
    $("adminCourses").textContent = error.message;
    return;
  }

  $("adminCourses").innerHTML = (data || []).map(c => `
    <article class="course">
      <div class="sectionTitle">
        <b>${esc(c.title)}</b>
        <span class="tag">${c.is_published ? "PUBLISHED" : "DRAFT"}</span>
      </div>

      <p>${money(c.price_inr)} · ${c.duration_days} days</p>

      <div class="actions">
        <button
          class="btn light"
          data-toggle="${c.id}"
          data-pub="${!c.is_published}"
        >
          ${c.is_published ? "Unpublish" : "Publish"}
        </button>
      </div>
    </article>
  `).join("") || '<p class="empty">No courses yet.</p>';

  $("adminCourses").querySelectorAll("[data-toggle]")
    .forEach(b => {
      b.onclick = async () => {
        const { error } = await sb
          .from("courses")
          .update({
            is_published: b.dataset.pub === "true"
          })
          .eq("id", b.dataset.toggle);

        if (error) {
          alert(error.message);
        } else {
          await loadCourses();
          await loadAdminCourses();
          await loadPaymentOptions();
        }
      };
    });
}


async function loadAssignments() {
  const { data: as, error } = await sb
    .from("assignments")
    .select("id,course_id,title,instructions,due_date,courses(title)")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (error) {
    $("myAssignments").innerHTML =
      '<p class="empty">Assignments are not available yet.</p>';
    return;
  }

  const { data: subs } = await sb
    .from("assignment_submissions")
    .select("assignment_id,status,submission_text,submitted_at")
    .eq("student_id", user.id);

  const subMap = new Map(
    (subs || []).map(s => [s.assignment_id, s])
  );

  let pendingCount = 0;

  $("myAssignments").innerHTML = as?.length
    ? as.map(a => {
      const enrolled = enrollments.some(
        e => e.course_id === a.course_id && e.status === "active"
      );

      if (!enrolled) return "";

      const s = subMap.get(a.id);

      if (!s || s.status === "needs_revision") {
        pendingCount++;
      }

      return `
        <article class="course">
          <h3>${esc(a.title)}</h3>

          <p class="fine">
            ${esc(a.courses?.title || "Course")} ·
            Due: ${dateLabel(a.due_date)}
          </p>

          <p>${esc(a.instructions)}</p>

          <p class="tag">
            ${s ? esc(s.status.toUpperCase()) : "NOT SUBMITTED"}
          </p>

          <form class="form submitAssignment" data-assignment="${a.id}">
            <label>
              Your answer / project link

              <textarea
                name="answer"
                required
                rows="3"
                placeholder="Write your answer or paste a project link"
              >${esc(s?.submission_text || "")}</textarea>
            </label>

            <button class="btn">
              ${s ? "Update submission" : "Submit assignment"}
            </button>

            <p class="message"></p>
          </form>
        </article>
      `;
    }).filter(Boolean).join("")
    : '<p class="empty">No assignments published yet.</p>';

  $("statTasks").textContent = pendingCount;

  document.querySelectorAll(".submitAssignment")
    .forEach(f => {
      f.onsubmit = async ev => {
        ev.preventDefault();

        const answer = new FormData(f)
          .get("answer")
          .toString()
          .trim();

        const { error } = await sb.rpc("submit_assignment", {
          p_assignment_id: f.dataset.assignment,
          p_submission_text: answer
        });

        say(
          f.querySelector(".message"),
          error?.message || "Submission saved.",
          !!error
        );

        if (!error) await loadAssignments();
      };
    });
}


async function loadQuizzes() {
  const { data: qs, error } = await sb
    .from("quiz_questions")
    .select("id,course_id,question,options,courses(title)")
    .eq("is_published", true)
    .order("created_at");

  if (error) {
    $("myQuizzes").innerHTML =
      '<p class="empty">Quizzes are not available yet.</p>';
    return;
  }

  const enrolledIds = new Set(
    enrollments
      .filter(e => e.status === "active")
      .map(e => e.course_id)
  );

  const relevant = (qs || []).filter(
    q => enrolledIds.has(q.course_id)
  );

  if (!relevant.length) {
    $("myQuizzes").innerHTML =
      '<p class="empty">Quizzes will appear for your enrolled courses.</p>';
    return;
  }

  const byCourse = {};

  relevant.forEach(q =>
    (byCourse[q.course_id] ??= {
      title: q.courses?.title || "Course",
      qs: []
    }).qs.push(q)
  );

  $("myQuizzes").innerHTML = Object.entries(byCourse)
    .map(([cid, g]) => `
      <article class="course">
        <h3>${esc(g.title)} quiz</h3>

        <form class="quizForm" data-course="${cid}">
          ${g.qs.map(q => `
            <fieldset class="question">
              <legend>${esc(q.question)}</legend>

              ${(q.options || []).map((o, i) => `
                <label>
                  <input
                    type="radio"
                    name="${q.id}"
                    value="${i}"
                    required
                  >
                  ${esc(o)}
                </label>
              `).join("")}
            </fieldset>
          `).join("")}

          <button class="btn">Submit quiz</button>
          <p class="message"></p>
        </form>
      </article>
    `).join("");

  document.querySelectorAll(".quizForm")
    .forEach(f => {
      f.onsubmit = async ev => {
        ev.preventDefault();

        const answers = {};

        new FormData(f).forEach((v, k) => {
          answers[k] = Number(v);
        });

        const { data, error } = await sb.rpc("submit_quiz", {
          p_course_id: f.dataset.course,
          p_answers: answers
        });

        say(
          f.querySelector(".message"),
          error?.message ||
            (data
              ? `Score: ${data.score}/${data.total} (${data.percentage}%)`
              : "Quiz submitted."),
          !!error
        );
      };
    });
}


async function loadSubmissions() {
  const { data, error } = await sb
    .from("assignment_submissions")
    .select("id,student_id,assignment_id,submission_text,status,submitted_at,assignments(title,courses(title))")
    .order("submitted_at", { ascending: false });

  if (error) {
    $("submissions").textContent = error.message;
    return;
  }

  $("submissions").innerHTML = data?.length
    ? data.map(s => `
      <article class
