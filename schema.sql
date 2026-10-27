-- THULIRVI TECHNOLOGIES LMS DATABASE
-- Run once in Supabase SQL Editor. Test in a fresh project first.
create extension if not exists pgcrypto;

create table public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text,
 role text not null default 'student' check(role in('student','admin')),
 created_at timestamptz not null default now()
);
create table public.courses(
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 1 and 120),
 description text not null default '',
 price_inr integer not null check(price_inr>=0),
 duration_days integer not null default 30 check(duration_days between 1 and 365),
 is_published boolean not null default false,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.lessons(
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id) on delete cascade,
 day_number integer not null check(day_number between 1 and 365),
 title text not null,
 content text not null default '',
 resource_url text,
 task_instructions text not null default '',
 is_published boolean not null default false,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(course_id,day_number)
);
create table public.payments(
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id),
 amount_inr integer not null check(amount_inr>=0),
 transaction_ref text not null check(char_length(transaction_ref) between 4 and 100),
 status text not null default 'pending' check(status in('pending','approved','rejected')),
 submitted_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references public.profiles(id),
 unique(student_id,transaction_ref),
 unique(transaction_ref)
);
create table public.enrollments(
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.profiles(id) on delete cascade,
 course_id uuid not null references public.courses(id),
 payment_id uuid not null unique references public.payments(id),
 status text not null default 'active' check(status in('active','revoked')),
 started_at timestamptz not null default now(),
 approved_at timestamptz not null default now(),
 unique(student_id,course_id)
);
create table public.lesson_completions(
 id uuid primary key default gen_random_uuid(),
 enrollment_id uuid not null references public.enrollments(id) on delete cascade,
 lesson_id uuid not null references public.lessons(id) on delete cascade,
 student_id uuid not null references public.profiles(id) on delete cascade,
 completed_at timestamptz not null default now(),
 unique(enrollment_id,lesson_id)
);
create table public.assignments(
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id) on delete cascade,
 title text not null,
 instructions text not null,
 due_date date,
 is_published boolean not null default false,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.assignment_submissions(
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.assignments(id) on delete cascade,
 student_id uuid not null references public.profiles(id) on delete cascade,
 submission_text text not null check(char_length(submission_text) between 1 and 10000),
 status text not null default 'submitted' check(status in('submitted','approved','needs_revision')),
 feedback text,
 submitted_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references public.profiles(id),
 unique(assignment_id,student_id)
);
create table public.quiz_questions(
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id) on delete cascade,
 question text not null,
 options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options)=4),
 correct_option integer not null check(correct_option between 0 and 3),
 is_published boolean not null default false,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.quiz_attempts(
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references public.courses(id) on delete cascade,
 student_id uuid not null references public.profiles(id) on delete cascade,
 score integer not null,
 total integer not null,
 percentage integer not null,
 submitted_at timestamptz not null default now()
);

-- Profile trigger: every new account becomes student. Never trust user-supplied role metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.profiles(id,full_name,role)
 values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),'student');
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;

-- Secure payment claim: course price is fetched from DB, never trusted from the browser.
create or replace function public.submit_payment_claim(p_course_id uuid,p_amount_inr integer,p_transaction_ref text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare c public.courses%rowtype; result_id uuid; ref text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into c from public.courses where id=p_course_id and is_published=true;
 if not found then raise exception 'Course not found or not available'; end if;
 if p_amount_inr<>c.price_inr then raise exception 'Amount does not match the course fee'; end if;
 ref:=trim(p_transaction_ref);
 if ref is null or char_length(ref)<4 or char_length(ref)>100 then raise exception 'Enter a valid transaction reference'; end if;
 if exists(select 1 from public.payments where transaction_ref=ref) then raise exception 'This transaction reference has already been submitted'; end if;
 insert into public.payments(student_id,course_id,amount_inr,transaction_ref,status)
 values(auth.uid(),p_course_id,c.price_inr,ref,'pending') returning id into result_id;
 return result_id;
end; $$;

create or replace function public.admin_review_payment(p_payment_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path=''
as $$
declare p public.payments%rowtype;
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 if p_new_status not in('approved','rejected') then raise exception 'Invalid status'; end if;
 select * into p from public.payments where id=p_payment_id for update;
 if not found then raise exception 'Payment not found'; end if;
 if p.status<>'pending' then raise exception 'Payment has already been reviewed'; end if;
 update public.payments set status=p_new_status,reviewed_at=now(),reviewed_by=auth.uid() where id=p_payment_id;
 if p_new_status='approved' then
  insert into public.enrollments(student_id,course_id,payment_id,status,started_at,approved_at)
  values(p.student_id,p.course_id,p.id,'active',now(),now())
  on conflict(student_id,course_id) do update set payment_id=excluded.payment_id,status='active',started_at=now(),approved_at=now();
 end if;
end; $$;

create or replace function public.submit_assignment(p_assignment_id uuid,p_submission_text text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare a public.assignments%rowtype; result_id uuid; txt text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 txt:=trim(p_submission_text);
 if txt is null or char_length(txt)<1 or char_length(txt)>10000 then raise exception 'Submission must be 1 to 10000 characters'; end if;
 select * into a from public.assignments where id=p_assignment_id and is_published=true;
 if not found then raise exception 'Assignment not found'; end if;
 if not exists(select 1 from public.enrollments e where e.student_id=auth.uid() and e.course_id=a.course_id and e.status='active') then raise exception 'Active course enrollment required'; end if;
 insert into public.assignment_submissions(assignment_id,student_id,submission_text,status,submitted_at)
 values(a.id,auth.uid(),txt,'submitted',now())
 on conflict(assignment_id,student_id) do update set submission_text=excluded.submission_text,status='submitted',submitted_at=now(),feedback=null,reviewed_at=null,reviewed_by=null
 returning id into result_id;
 return result_id;
end; $$;

create or replace function public.review_assignment(p_submission_id uuid,p_status text,p_feedback text default '')
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 if p_status not in('approved','needs_revision') then raise exception 'Invalid review status'; end if;
 update public.assignment_submissions set status=p_status,feedback=left(coalesce(p_feedback,''),5000),reviewed_at=now(),reviewed_by=auth.uid() where id=p_submission_id;
 if not found then raise exception 'Submission not found'; end if;
end; $$;

create or replace function public.submit_quiz(p_course_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare q record; n integer:=0; score_n integer:=0; answer text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if not exists(select 1 from public.enrollments e where e.student_id=auth.uid() and e.course_id=p_course_id and e.status='active') then raise exception 'Active course enrollment required'; end if;
 if jsonb_typeof(p_answers)<>'object' then raise exception 'Invalid answers'; end if;
 for q in select id,correct_option from public.quiz_questions where course_id=p_course_id and is_published=true loop
  n:=n+1; answer:=p_answers->>q.id::text;
  if answer ~ '^[0-3]$' and answer::integer=q.correct_option then score_n:=score_n+1; end if;
 end loop;
 if n=0 then raise exception 'No published questions'; end if;
 insert into public.quiz_attempts(course_id,student_id,score,total,percentage) values(p_course_id,auth.uid(),score_n,n,round(score_n*100.0/n)::integer);
 return jsonb_build_object('score',score_n,'total',n,'percentage',round(score_n*100.0/n)::integer);
end; $$;

-- Enable RLS everywhere.
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.payments enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_completions enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;

create policy "profile self/admin read" on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy "profile self basic update" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role='student');
create policy "published course catalogue" on public.courses for select to authenticated using(is_published or public.is_admin());
create policy "admin course insert" on public.courses for insert to authenticated with check(public.is_admin());
create policy "admin course update" on public.courses for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin course delete" on public.courses for delete to authenticated using(public.is_admin());

-- The DB policy blocks reads of future lessons even if a student guesses the lesson UUID.
create policy "read unlocked lessons only" on public.lessons for select to authenticated using(
 public.is_admin() or (is_published and exists(select 1 from public.enrollments e where e.course_id=lessons.course_id and e.student_id=auth.uid() and e.status='active' and lessons.day_number <= floor(extract(epoch from(now()-e.started_at))/86400)::integer+1))
);
create policy "admin lesson insert" on public.lessons for insert to authenticated with check(public.is_admin());
create policy "admin lesson update" on public.lessons for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin lesson delete" on public.lessons for delete to authenticated using(public.is_admin());

create policy "payment own/admin read" on public.payments for select to authenticated using(student_id=auth.uid() or public.is_admin());
create policy "enrollment own/admin read" on public.enrollments for select to authenticated using(student_id=auth.uid() or public.is_admin());
create policy "completion own/admin read" on public.lesson_completions for select to authenticated using(student_id=auth.uid() or public.is_admin());
create policy "student complete unlocked lesson" on public.lesson_completions for insert to authenticated with check(
 student_id=auth.uid() and exists(select 1 from public.enrollments e join public.lessons l on l.id=lesson_id and l.course_id=e.course_id where e.id=enrollment_id and e.student_id=auth.uid() and e.status='active' and l.is_published and l.day_number<=floor(extract(epoch from(now()-e.started_at))/86400)::integer+1)
);
create policy "read assignments for enrolled course" on public.assignments for select to authenticated using(public.is_admin() or (is_published and exists(select 1 from public.enrollments e where e.course_id=assignments.course_id and e.student_id=auth.uid() and e.status='active')));
create policy "admin assignment insert" on public.assignments for insert to authenticated with check(public.is_admin());
create policy "admin assignment update" on public.assignments for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin assignment delete" on public.assignments for delete to authenticated using(public.is_admin());
create policy "own/admin submission read" on public.assignment_submissions for select to authenticated using(student_id=auth.uid() or public.is_admin());
create policy "quiz questions for enrolled course" on public.quiz_questions for select to authenticated using(public.is_admin() or (is_published and exists(select 1 from public.enrollments e where e.course_id=quiz_questions.course_id and e.student_id=auth.uid() and e.status='active')));
create policy "admin quiz insert" on public.quiz_questions for insert to authenticated with check(public.is_admin());
create policy "admin quiz update" on public.quiz_questions for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin quiz delete" on public.quiz_questions for delete to authenticated using(public.is_admin());
create policy "own/admin quiz attempts read" on public.quiz_attempts for select to authenticated using(student_id=auth.uid() or public.is_admin());

-- Do not grant direct write privileges to payments/enrollments/submissions/attempts.
grant usage on schema public to authenticated;
grant select,update on public.profiles to authenticated;
grant select,insert,update,delete on public.courses to authenticated;
grant select,insert,update,delete on public.lessons to authenticated;
grant select on public.payments,public.enrollments,public.assignment_submissions,public.quiz_attempts to authenticated;
grant select,insert on public.lesson_completions to authenticated;
grant select,insert,update,delete on public.assignments to authenticated;
grant select,insert,update,delete on public.quiz_questions to authenticated;

revoke all on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.submit_payment_claim(uuid,integer,text) from public,anon;
grant execute on function public.submit_payment_claim(uuid,integer,text) to authenticated;
revoke all on function public.admin_review_payment(uuid,text) from public,anon;
grant execute on function public.admin_review_payment(uuid,text) to authenticated;
revoke all on function public.submit_assignment(uuid,text) from public,anon;
grant execute on function public.submit_assignment(uuid,text) to authenticated;
revoke all on function public.review_assignment(uuid,text,text) from public,anon;
grant execute on function public.review_assignment(uuid,text,text) to authenticated;
revoke all on function public.submit_quiz(uuid,jsonb) from public,anon;
grant execute on function public.submit_quiz(uuid,jsonb) to authenticated;

-- SETUP AFTER YOU CREATE YOUR OWN ACCOUNT:
-- 1. Authentication > Users: copy your UUID.
-- 2. Run this with YOUR UUID:
-- update public.profiles set role='admin' where id='YOUR_AUTH_USER_UUID';
-- Do not let students update their role.
