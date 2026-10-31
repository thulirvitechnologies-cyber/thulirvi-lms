/* Thulirvi LMS frontend. All privileged operations are protected by SQL/RLS. */
const cfg = window.THULIRVI_CONFIG || {};
const configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.startsWith("https://") && !cfg.SUPABASE_URL.includes("PASTE_") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
const $ = id => document.getElementById(id);
let sb, user, profile, courses = [], enrollments = [];
const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(n||0));
const say = (target,t,bad=false)=>{const el=typeof target==="string"?$(target):target;if(el){el.textContent=t||"";el.style.color=bad?"#b42318":"var(--teal)";}};
const safeUrl = s => {try{const u=new URL(s);return ["https:","http:"].includes(u.protocol)?u.href:null}catch{return null}};
const dateLabel = d => d ? new Date(d).toLocaleDateString("en-IN") : "No due date";
// Existing schema stores lesson teaching material in content. Admins can structure it with these headings.
function renderLessonContent(raw){
 const text=String(raw||"");
 const parts=text.split(/\n(?=(?:EXPLANATION|EXAMPLES|EXPECTED OUTPUT)\s*:?)/i);
 if(parts.length===1)return `<div class="explanation"><h4>📘 Explanation & examples</h4><p>${esc(text).replace(/\n/g,"<br>")}</p></div>`;
 return parts.map(part=>{const m=part.match(/^(EXPLANATION|EXAMPLES|EXPECTED OUTPUT)\s*:?\s*/i);const label=m?m[1].toUpperCase():"LESSON";const body=m?part.slice(m[0].length):part;const title=label==="EXPLANATION"?"📘 Topic explanation":label==="EXAMPLES"?"💡 Examples":"🖥️ Expected output";return `<div class="explanation"><h4>${title}</h4><p>${esc(body).replace(/\n/g,"<br>")}</p></div>`}).join("");
}
function showAuth(){ $("authView").hidden=false;$("appView").hidden=true;$("logoutBtn").hidden=true;$("userEmail").textContent=""; }
function showApp(){ $("authView").hidden=true;$("appView").hidden=false;$("logoutBtn").hidden=false;$("userEmail").textContent=user?.email||"";$("hello").textContent=profile?.full_name?`Welcome, ${profile.full_name}`:"My dashboard";$("roleBadge").textContent=(profile?.role||"student").toUpperCase();$("adminView").hidden=profile?.role!=="admin"; }
async function init(){
 if(!configured){$("configWarning").hidden=false;return;}
 $("configWarning").hidden=true;
 sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const {data:{session}}=await sb.auth.getSession();
 if(session){user=session.user;await afterLogin()}else showAuth();
 sb.auth.onAuthStateChange((_e,s)=>{setTimeout(async()=>{user=s?.user||null;if(user)await afterLogin();else{profile=null;showAuth()}},0)});
}
async function afterLogin(){
 const {data:p,error}=await sb.from("profiles").select("id,full_name,role").eq("id",user.id).maybeSingle();
 if(error||!p){showApp();say("globalMsg","Profile could not load. Confirm schema.sql ran successfully and profile trigger is installed.",true);return;}
 profile=p;showApp();await loadCourses();await loadEnrollments();await loadAssignments();await loadQuizzes();
 if(profile.role==="admin"){await loadPending();await loadAdminCourses();await loadSubmissions();await loadQuizBank();await loadStudents();}
}
async function loadCourses(){
 const {data,error}=await sb.from("courses").select("id,title,description,price_inr,duration_days,is_published").eq("is_published",true).order("title");
 if(error){["payCourse","lessonCourse","assignmentCourse","quizCourse"].forEach(id=>{if($(id))$(id).innerHTML=""});say("globalMsg","Course list unavailable. Check Supabase connection and database access.",true);return}
 courses=data||[];
 const opts=courses.map(c=>`<option value="${c.id}">${esc(c.title)} · ${money(c.price_inr)}</option>`).join("");
 ["payCourse","lessonCourse","assignmentCourse","quizCourse"].forEach(id=>{if($(id))$(id).innerHTML=opts});
 $("payAmount").value=courses[0]?.price_inr??"";
 $("payCourse").onchange=()=>{$("payAmount").value=courses.find(c=>c.id===$("payCourse").value)?.price_inr??""};
}
async function loadEnrollments(){
 const {data,error}=await sb.from("enrollments").select("id,course_id,status,started_at,courses(id,title,description)").eq("student_id",user.id).order("started_at",{ascending:false});
 if(error){$("myCourses").innerHTML='<p class="empty">Could not load course access.</p>';return}
 enrollments=data||[];
 let totalDone=0,totalLessons=0,pending=0;const cards=[];
 for(const e of enrollments){
  const title=e.courses?.title||"Course";
  if(e.status!=="active"){cards.push(`<article class="course"><h3>${esc(title)}</h3><span class="tag">ACCESS REVOKED</span></article>`);continue}
  const {data:ls,error:le}=await sb.from("lessons").select("id,day_number,title,content,resource_url,task_instructions").eq("course_id",e.course_id).eq("is_published",true).order("day_number");
  if(le){cards.push(`<article class="course"><h3>${esc(title)}</h3><p>Could not load lessons.</p></article>`);continue}
  const {data:done}=await sb.from("lesson_completions").select("lesson_id").eq("enrollment_id",e.id);
  const completed=new Set((done||[]).map(x=>x.lesson_id));totalDone+=completed.size;totalLessons+=(ls||[]).length;
  const elapsed=Math.max(0,Math.floor((Date.now()-new Date(e.started_at).getTime())/86400000)),unlock=elapsed+1;
  const lessonHtml=(ls||[]).map(l=>{
   const open=l.day_number<=unlock,finished=completed.has(l.id),href=safeUrl(l.resource_url);
   return `<article class="lesson ${open?"":"locked"}"><div class="sectionTitle"><h3>Day ${l.day_number}: ${esc(l.title)}</h3><span class="tag">${finished?"COMPLETED":open?"UNLOCKED":"🔒 LOCKED"}</span></div>${open?`<div class="lesson-content">${renderLessonContent(l.content)}</div>${href?`<p><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open resource ↗</a></p>`:""}<div class="taskBox"><b>🧩 Today's unique task</b><p>${esc(l.task_instructions||"Task not published yet. Please contact the course admin.")}</p></div>${!finished?`<button class="btn" data-complete="${l.id}" data-enroll="${e.id}">Mark lesson complete</button>`:""}`:`<p>This lesson unlocks on Day ${l.day_number}, based on your enrollment start date.</p>`}</article>`;
  }).join("");
  cards.push(`<article class="course"><h3>${esc(title)}</h3><p class="fine">Started ${dateLabel(e.started_at)}</p><p>${(ls||[]).length?Math.round(completed.size/ls.length*100):0}% lesson progress</p><div class="progress"><span style="width:${(ls||[]).length?Math.round(completed.size/ls.length*100):0}%"></span></div>${lessonHtml||'<p class="empty">Lessons are being prepared.</p>'}</article>`);
 }
 $("myCourses").innerHTML=cards.length?cards.join(""):'<p class="empty">You have no enrollments yet. Submit a payment claim below; access starts after admin approval.</p>';
 $("myCourses").querySelectorAll("[data-complete]").forEach(b=>b.onclick=async()=>{
  b.disabled=true;const {error}=await sb.from("lesson_completions").insert({enrollment_id:b.dataset.enroll,lesson_id:b.dataset.complete,student_id:user.id});
  if(error&&error.code!=="23505")alert("Could not save progress: "+error.message);await loadEnrollments();
 });
 $("statCourses").textContent=enrollments.filter(e=>e.status==="active").length;$("statDone").textContent=totalDone;
}
async function loadPending(){
 const {data,error}=await sb.from("payments").select("id,student_id,course_id,amount_inr,transaction_ref,submitted_at,status,courses(title)").eq("status","pending").order("submitted_at");
 if(error){$("pendingPayments").innerHTML='<p class="empty">Could not load payments.</p>';return}
 $("pendingPayments").innerHTML=data?.length?data.map(p=>`<article class="payment"><b>${esc(p.courses?.title||"Course")}</b><p class="fine">Student UUID: ${esc(p.student_id)}<br>Submitted: ${dateLabel(p.submitted_at)}<br>Amount: ${money(p.amount_inr)}<br>UTR: ${esc(p.transaction_ref)}</p><div class="actions"><button class="btn" data-review="${p.id}" data-status="approved">Approve & grant access</button><button class="btn danger" data-review="${p.id}" data-status="rejected">Reject</button></div></article>`).join(""):'<p class="empty">No pending payment requests.</p>';
 $("pendingPayments").querySelectorAll("[data-review]").forEach(b=>b.onclick=async()=>{if(!confirm(`Confirm ${b.dataset.status}? Verify actual credit in your bank/UPI app first.`))return;b.disabled=true;const {error}=await sb.rpc("admin_review_payment",{p_payment_id:b.dataset.review,p_new_status:b.dataset.status});if(error){alert(error.message);b.disabled=false;return}await loadPending();await loadEnrollments();});
}
async function loadAdminCourses(){
 const {data,error}=await sb.from("courses").select("id,title,price_inr,is_published,duration_days").order("created_at",{ascending:false});
 if(error){$("adminCourses").textContent=error.message;return}
 $("adminCourses").innerHTML=(data||[]).map(c=>`<article class="course"><div class="sectionTitle"><b>${esc(c.title)}</b><span class="tag">${c.is_published?"PUBLISHED":"DRAFT"}</span></div><p>${money(c.price_inr)} · ${c.duration_days} days</p><div class="actions"><button class="btn light" data-toggle="${c.id}" data-pub="${!c.is_published}">${c.is_published?"Unpublish":"Publish"}</button></div></article>`).join("")||'<p class="empty">No courses yet.</p>';
 $("adminCourses").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{const {error}=await sb.from("courses").update({is_published:b.dataset.pub==="true"}).eq("id",b.dataset.toggle);if(error)alert(error.message);else{await loadCourses();await loadAdminCourses()}});
}
async function loadAssignments(){
 const {data:as,error}=await sb.from("assignments").select("id,course_id,title,instructions,due_date,courses(title)").eq("is_published",true).order("created_at",{ascending:false});
 if(error){$("myAssignments").innerHTML='<p class="empty">Assignments are not available yet.</p>';return}
 const {data:subs}=await sb.from("assignment_submissions").select("assignment_id,status,submission_text,submitted_at").eq("student_id",user.id);
 const subMap=new Map((subs||[]).map(s=>[s.assignment_id,s]));
 let pendingCount=0;
 $("myAssignments").innerHTML=as?.length?as.map(a=>{
  const enrolled=enrollments.some(e=>e.course_id===a.course_id&&e.status==="active");
  if(!enrolled)return "";
  const s=subMap.get(a.id);if(!s||s.status==="needs_revision")pendingCount++;
  return `<article class="course"><h3>${esc(a.title)}</h3><p class="fine">${esc(a.courses?.title||"Course")} · Due: ${dateLabel(a.due_date)}</p><p>${esc(a.instructions)}</p><p class="tag">${s?esc(s.status.toUpperCase()):"NOT SUBMITTED"}</p><form class="form submitAssignment" data-assignment="${a.id}"><label>Your answer / project link<textarea name="answer" required rows="3" placeholder="Write your answer or paste a project link">${esc(s?.submission_text||"")}</textarea></label><button class="btn">${s?"Update submission":"Submit assignment"}</button><p class="message"></p></form></article>`;
 }).filter(Boolean).join("")||'<p class="empty">No assignments for your enrolled courses yet.</p>':'<p class="empty">No assignments published yet.</p>';
 $("statTasks").textContent=pendingCount;
 document.querySelectorAll(".submitAssignment").forEach(f=>f.onsubmit=async ev=>{ev.preventDefault();const answer=new FormData(f).get("answer").toString().trim();const {error}=await sb.rpc("submit_assignment",{p_assignment_id:f.dataset.assignment,p_submission_text:answer});say(f.querySelector(".message"),error?.message||"Submission saved.",!!error);if(!error)await loadAssignments()});
}
async function loadQuizzes(){
 const {data:qs,error}=await sb.from("quiz_questions").select("id,course_id,question,options,courses(title)").eq("is_published",true).order("created_at");
 if(error){$("myQuizzes").innerHTML='<p class="empty">Quizzes are not available yet.</p>';return}
 const enrolledIds=new Set(enrollments.filter(e=>e.status==="active").map(e=>e.course_id));
 const relevant=(qs||[]).filter(q=>enrolledIds.has(q.course_id));
 if(!relevant.length){$("myQuizzes").innerHTML='<p class="empty">Quizzes will appear for your enrolled courses.</p>';return}
 const byCourse={};relevant.forEach(q=>(byCourse[q.course_id]??={title:q.courses?.title||"Course",qs:[]}).qs.push(q));
 $("myQuizzes").innerHTML=Object.entries(byCourse).map(([cid,g])=>`<article class="course"><h3>${esc(g.title)} quiz</h3><form class="quizForm" data-course="${cid}">${g.qs.map(q=>`<fieldset class="question"><legend>${esc(q.question)}</legend>${(q.options||[]).map((o,i)=>`<label><input type="radio" name="${q.id}" value="${i}" required> ${esc(o)}</label>`).join("")}</fieldset>`).join("")}<button class="btn">Submit quiz</button><p class="message"></p></form></article>`).join("");
 document.querySelectorAll(".quizForm").forEach(f=>f.onsubmit=async ev=>{ev.preventDefault();const answers={};new FormData(f).forEach((v,k)=>answers[k]=Number(v));const {data,error}=await sb.rpc("submit_quiz",{p_course_id:f.dataset.course,p_answers:answers});say(f.querySelector(".message"),error?.message||(data?`Score: ${data.score}/${data.total} (${data.percentage}%)`:"Quiz submitted."),!!error)});
}
async function loadSubmissions(){
 const {data,error}=await sb.from("assignment_submissions").select("id,student_id,assignment_id,submission_text,status,submitted_at,assignments(title,courses(title))").order("submitted_at",{ascending:false});
 if(error){$("submissions").textContent=error.message;return}
 $("submissions").innerHTML=data?.length?data.map(s=>`<article class="submission"><b>${esc(s.assignments?.title||"Assignment")}</b><p class="fine">Student ${esc(s.student_id)} · ${dateLabel(s.submitted_at)} · ${esc(s.status)}</p><p>${esc(s.submission_text)}</p><label>Feedback<textarea id="feedback-${s.id}" rows="2"></textarea></label><div class="actions"><button class="btn" data-grade="${s.id}" data-status="approved">Approve</button><button class="btn light" data-grade="${s.id}" data-status="needs_revision">Request revision</button></div></article>`).join(""):'<p class="empty">No submissions yet.</p>';
 $("submissions").querySelectorAll("[data-grade]").forEach(b=>b.onclick=async()=>{const feedback=$("feedback-"+b.dataset.grade).value;const {error}=await sb.rpc("review_assignment",{p_submission_id:b.dataset.grade,p_status:b.dataset.status,p_feedback:feedback});if(error)alert(error.message);else await loadSubmissions()});
}
async function loadQuizBank(){
 const {data,error}=await sb.from("quiz_questions").select("id,course_id,question,is_published,courses(title)").order("created_at",{ascending:false});
 if(error){$("quizBank").textContent=error.message;return}
 $("quizBank").innerHTML=data?.map(q=>`<article class="question"><b>${esc(q.courses?.title||"Course")}</b><p>${esc(q.question)}</p><span class="tag">${q.is_published?"PUBLISHED":"UNPUBLISHED"}</span></article>`).join("")||'<p class="empty">No questions yet.</p>';
}
async function loadStudents(){
 const {data,error}=await sb.from("profiles").select("id,full_name,role,created_at").order("created_at",{ascending:false});
 if(error){$("studentsList").textContent=error.message;return}
 $("studentsList").innerHTML=data?.map(p=>`<article class="course"><b>${esc(p.full_name||"Student")}</b><p class="fine">UUID: ${esc(p.id)} · ${esc(p.role)} · Joined ${dateLabel(p.created_at)}</p></article>`).join("")||'<p class="empty">No profiles found.</p>';
}
$("authForm").onsubmit=async e=>{e.preventDefault();const {error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});say("authMsg",error?.message||"Signed in.",!!error)};
$("signupBtn").onclick=async()=>{const {data,error}=await sb.auth.signUp({email:$("email").value.trim(),password:$("password").value});say("authMsg",error?.message||(data.session?"Account created.":"Account created. Check your email to confirm, then sign in."),!!error)};
$("resetBtn").onclick=async()=>{const email=$("email").value.trim();if(!email){say("authMsg","Enter your email first.",true);return}const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});say("authMsg",error?.message||"If the email is registered, a password-reset email will arrive. Configure the redirect URL in Supabase Auth.",!!error)};
$("logoutBtn").onclick=async()=>{await sb.auth.signOut();user=null;profile=null;showAuth()};
$("payCourse").onchange=()=>{$("payAmount").value=courses.find(c=>c.id===$("payCourse").value)?.price_inr??""};
$("paymentForm").onsubmit=async e=>{e.preventDefault();const c=courses.find(c=>c.id===$("payCourse").value);if(!c)return;const amount=Number($("payAmount").value);if(amount!==Number(c.price_inr)){say("payMsg","Amount must match the current course fee.",true);return}const {error}=await sb.rpc("submit_payment_claim",{p_course_id:c.id,p_amount_inr:amount,p_transaction_ref:$("payRef").value.trim()});say("payMsg",error?.message||"Payment reference submitted. Access is pending until admin verifies the actual credit.",!!error);if(!error){$("payRef").value="";await loadEnrollments()}};
$("courseForm").onsubmit=async e=>{e.preventDefault();const {error}=await sb.from("courses").insert({title:$("courseTitle").value.trim(),description:$("courseDesc").value.trim(),price_inr:Number($("coursePrice").value),duration_days:Number($("courseDuration").value),is_published:true,created_by:user.id});say("courseMsg",error?.message||"Course created.",!!error);if(!error){e.target.reset();await loadCourses();await loadAdminCourses()}};
$("lessonForm").onsubmit=async e=>{e.preventDefault();const {error}=await sb.from("lessons").insert({course_id:$("lessonCourse").value,day_number:Number($("lessonDay").value),title:$("lessonTitle").value.trim(),content:[`EXPLANATION:\n${$("lessonContent").value.trim()}`,`EXAMPLES:\n${$("lessonExamples").value.trim()||"Examples will be added by the instructor."}`,`EXPECTED OUTPUT:\n${$("lessonOutput").value.trim()||"Refer to the examples above."}`].join("\n\n"),resource_url:$("lessonUrl").value.trim()||null,task_instructions:$("lessonTask").value.trim(),is_published:true,created_by:user.id});say("lessonMsg",error?.message||"Lesson published.",!!error);if(!error){e.target.reset();await loadEnrollments()}};
$("assignmentForm").onsubmit=async e=>{e.preventDefault();const {error}=await sb.from("assignments").insert({course_id:$("assignmentCourse").value,title:$("assignmentTitle").value.trim(),instructions:$("assignmentInstructions").value.trim(),due_date:$("assignmentDue").value||null,is_published:true,created_by:user.id});say("assignmentMsg",error?.message||"Assignment published.",!!error);if(!error){e.target.reset();await loadAssignments()}};
$("quizForm").onsubmit=async e=>{e.preventDefault();const {error}=await sb.from("quiz_questions").insert({course_id:$("quizCourse").value,question:$("quizQuestion").value.trim(),options:[$("optA").value.trim(),$("optB").value.trim(),$("optC").value.trim(),$("optD").value.trim()],correct_option:Number($("correctOpt").value),is_published:true,created_by:user.id});say("quizAdminMsg",error?.message||"Question added.",!!error);if(!error){e.target.reset();await loadQuizBank();await loadQuizzes()}};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".tabbody").forEach(x=>x.hidden=x.id!==b.dataset.tab)});
init();