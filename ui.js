'use strict';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
const student = SmartApp.getCurrentStudent;
const data = SmartApp.getStudentData;
const plan = SmartApp.getPlanInstance;
const courses = COURSE_CATALOGUE.filter(c => !c.isPriorCreditOnly);
const findCourse = code => CourseFP.findCourseByCode(courses, code);
const courseLabel = c => `${c.code} · ${c.title} (${c.credits} cr)`;
const termLabel = c => c.isElective ? 'Semesters 7 & 8' : c.isInternship ? c.year + ' · Internship' : 'Semester ' + c.semester;
const termOptions = SEMESTER_CONFIG.map(t => option(t.id, t.label)).join('');
const trackOptions = option('', 'Choose a concentration') + ['Artificial Intelligence', 'Cybersecurity'].map(t => option(t, t)).join('');
const currentTerm = () => PROGRAM_TERMS.find(t => t.key === $('record-term').value);
const titles = {
  auth: ['Student registration', 'Create an account or sign in to continue your course plan.'],
  profile: ['Student profile', 'Manage your semester, registration limit and prior credit.'],
  records: ['Academic record', 'Enter the cumulative GPA from your transcript or calculate it from your course grades.'],
  catalogue: ['Course catalogue', 'Explore the programme and see which courses fit your plan.'],
  planner: ['Registration planner', 'Build your semester plan and check your remaining credits.'],
  advisor: ['Academic advising', 'Review course recommendations and leave feedback on your advising session.']
};
let view = 'auth';
let editingFeedbackId = null;

function notice(message = '', error = false) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').className = error ? 'warning' : 'success';
}

function navigate(next) {
  view = student() ? next : 'auth';
  for (const id of Object.keys(titles)) $(id).hidden = id !== view;
  $('page-title').textContent = titles[view][0];
  $('page-intro').textContent = titles[view][1];
  $('nav').hidden = $('sign-out').hidden = !student();
  $('session-name').textContent = student() ? student().fullName : 'Amity University Dubai';
  document.querySelectorAll('#nav button').forEach(btn => {
    if (btn.dataset.view === view) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  notice();
  renderView();
  window.scrollTo(0, 0);
}

function renderView() {
  if (!student()) return;
  ({ profile: renderProfile, records: renderRecords, catalogue: renderCatalogue, planner: renderPlanner, advisor: renderAdvisor })[view]();
}

function configureTrack(prefix) {
  const year4 = Number($(prefix + '-semester-select').value) >= 7;
  const select = $(prefix + '-concentration-select');
  $(prefix + '-concentration-group').hidden = !year4;
  select.required = year4;
  select.disabled = !year4;
  if (prefix === 'reg') $('initial-cgpa-group').hidden = $('reg-semester-select').value !== '1';
}

function selectAuthMode(returning) {
  $('new-tab').setAttribute('aria-pressed', String(!returning));
  $('login-tab').setAttribute('aria-pressed', String(returning));
  $('login').hidden = !returning;
  $('signup').hidden = returning;
  notice();
}

function resetSemesterControls() {
  const semester = student().currentSemester;
  $('catalogue-semester-filter').value = semester;
  $('catalogue-search').value = $('catalogue-status').value = '';
  $('planner-course').value = $('advisor-course').value = '';
  const terms = PROGRAM_TERMS.filter(t => t.order <= semester);
  $('record-term').innerHTML = terms.map(t => option(t.key, t.label)).join('');
  const suggested = SmartApp.getContext().standing.missingTerm || terms.filter(t => t.id && t.order < semester).pop() || terms[0];
  $('record-term').value = suggested.key || suggested.year + '_' + suggested.term;
  loadTerm();
}

function enterAccount(result, next) {
  if (!result.success) return notice(result.reason, true);
  $('login').reset();
  $('signup').reset();
  configureTrack('reg');
  $('feedback').reset();
  resetSemesterControls();
  navigate(next);
}

function signOut() {
  SmartApp.logout();
  $('term-form').reset();
  $('feedback').reset();
  $('feedback-list').replaceChildren();
  $('record-courses').replaceChildren();
  selectAuthMode(true);
  navigate('auth');
}

function metric(label, value) {
  return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function standingInfo() {
  const { standing } = SmartApp.getContext();
  if (standing.isPending) return `<div class="callout warning"><strong>Standing pending</strong>
    <p>Enter the result for ${esc(standing.missingTerm.label)} to calculate your credit limit.</p>
    <button class="text-button" data-missing="${esc(standing.missingTerm.key)}">Enter missing result</button></div>`;
  const messages = {
    'Academic Probation 1': 'One graded term below 2.00 sets a maximum of 12 credits.',
    'Academic Probation 2': 'Consecutive graded terms below 2.00 set a maximum of 9 credits.',
    'Good Standing': 'Your latest CGPA is at least 2.00. Your regular credit limit applies.',
    'No CGPA yet': 'Your regular credit limit applies until your first graded result.'
  };
  return `<div class="callout"><strong>${esc(standing.standing)}</strong><p>${messages[standing.standing]}</p></div>`;
}

function renderProfile() {
  const s = student();
  const { standing, earned } = SmartApp.getContext();
  $('profile-metrics').innerHTML = metric('Current semester', s.currentSemester + ' of 8') +
    metric('Earned credits', earned + ' / 125') + metric(standing.cgpaSource === 'calculated' ? 'Calculated CGPA' : 'Latest CGPA', standing.cgpa?.toFixed(2) ?? '—') +
    metric('Credit limit', standing.isPending ? 'Pending' : standing.creditLimit);
  $('profile-semester-select').value = s.currentSemester;
  $('profile-concentration-select').value = s.concentration || '';
  configureTrack('profile');
  $('profile-regular-limit').value = s.regularCreditLimit;
  $('prior-math').checked = data().priorCredits.includes('MATH 125');
  $('profile-standing').innerHTML = standingInfo();
  $('advance').disabled = s.currentSemester >= 8;
}

function saveSettings() {
  const semester = Number($('profile-semester-select').value);
  const changed = semester !== student().currentSemester;
  const previousTrack = student().concentration;
  const res = SmartApp.updateProfileSettings($('profile-concentration-select').value, Number($('profile-regular-limit').value),
    $('prior-math').checked ? ['MATH 125'] : [], semester);
  if (!res.success) return notice(res.reason, true);
  if (changed) resetSemesterControls();
  else if (previousTrack !== student().concentration && currentTerm().id >= 7) {
    renderTermCourses(currentTerm(), selectedGrades());
    updateCalculation();
  }
  renderProfile();
  notice('Settings saved for Semester ' + semester + '.');
}

function suggestedCourses(term) {
  return courses.filter(c => c.year === term.year && c.term === term.term ||
    (term.id >= 7 && c.isElective && c.concentration === student().concentration));
}

function gradeRow(course, entry) {
  const row = document.createElement('div');
  row.className = 'grade-row';
  row.dataset.code = course.code;
  row.innerHTML = `<label class="check"><input type="checkbox" class="course-check"><span><b>${esc(course.code)}</b> ${esc(course.title)}
    <small>${course.credits} credits${course.isElective ? ' · Concentration elective' : ''}</small></span></label>
    <select class="grade" aria-label="Grade for ${esc(course.code)}">${option('', 'Grade') + LETTER_GRADES.map(g => option(g, g)).join('')}</select>`;
  const checkbox = row.querySelector('input');
  const grade = row.querySelector('select');
  checkbox.checked = !!entry;
  grade.value = entry?.grade || '';
  grade.disabled = !entry;
  checkbox.onchange = () => { grade.disabled = !checkbox.checked; };
  $('record-courses').append(row);
}

function selectedGrades() {
  return Array.from($('record-courses').children).filter(row => row.querySelector('input').checked)
    .map(row => ({ code: row.dataset.code, grade: row.querySelector('select').value }));
}

function updateCalculation() {
  if ($('calculation').hidden) return;
  const result = CourseFP.calculateCgpa(data().academicRecords, currentTerm(), selectedGrades(),
    !$('first-graded-group').hidden && $('first-graded').checked);
  $('cgpa-preview').textContent = result.cgpa === null ? result.reason :
    [result.cgpa.toFixed(2) + ' / 4.00 · ' + result.credits + ' graded credits', result.note].filter(Boolean).join('. ');
}

function toggleCgpa() {
  const ungraded = $('ungraded').checked;
  const calculated = $('cgpa-source').value === 'calculated';
  $('cgpa-source').disabled = ungraded;
  $('official-cgpa-field').hidden = $('record-cgpa').disabled = ungraded || calculated;
  $('record-cgpa').required = !ungraded && !calculated;
  $('calculation').hidden = ungraded || !calculated;
  const term = currentTerm();
  const olderGraded = data().academicRecords.some(r => r.isFinalised && r.cgpa != null &&
    CourseFP.getTermOrderKey(r.year, r.term) < term.order);
  $('first-graded-group').hidden = term.order === 1 || olderGraded || $('ungraded').checked;
  updateCalculation();
}

function loadTerm() {
  const term = currentTerm();
  const record = data().drafts[term.key] || data().academicRecords.find(r => r.year === term.year && r.term === term.term);
  const entries = record?.courses || [];
  $('cgpa-source').value = record?.cgpaSource || 'manual';
  $('record-cgpa').value = record?.cgpaSource === 'calculated' ? '' : record?.cgpa ?? '';
  $('ungraded').checked = !!record?.ungraded || (!!record?.awaitingResult && student().currentSemester === 1);
  $('ungraded-label').textContent = term.id === 1 && student().currentSemester === 1 ? 'No CGPA yet' : 'This term had no graded result';
  $('first-graded').checked = !!record?.firstGraded;
  renderTermCourses(term, entries);
  toggleCgpa();
}

function renderTermCourses(term, entries) {
  $('record-courses').replaceChildren();
  const suggested = suggestedCourses(term);
  const available = new Map(suggested.map(c => [c.code, c]));
  entries.forEach(entry => { const course = findCourse(entry.code); if (course) available.set(course.code, course); });
  available.forEach(c => gradeRow(c, entries.find(e => e.code === c.code)));
  $('extra-course').innerHTML = option('', 'Choose another course') +
    courses.filter(c => !available.has(c.code)).map(c => option(c.code, courseLabel(c))).join('');
  $('record-help').textContent = term.id >= 7
    ? 'Select all includes the scheduled core courses. Choose your own ' + (term.id === 7 ? 'three' : 'two') + ' concentration electives.'
    : 'Select each course you took, then choose its grade.';
}

function saveRecord(finalised) {
  const term = currentTerm();
  const entries = selectedGrades();
  const ungraded = $('ungraded').checked;
  const res = SmartApp.saveTermRecord(term.year, term.term, ungraded ? null : $('record-cgpa').value, entries, finalised,
    { ungraded, cgpaSource: $('cgpa-source').value, firstGraded: !$('first-graded-group').hidden && $('first-graded').checked });
  if (!res.success) return notice(res.reason, true);
  renderRecords();
  notice((finalised ? 'Term result saved for ' : 'Draft saved for ') + term.label + '.');
}

function renderRecords() {
  $('record-standing').innerHTML = standingInfo();
  const history = CourseFP.calculateStandingHistory(data().academicRecords, student().regularCreditLimit);
  const terms = PROGRAM_TERMS.filter(t => data().drafts[t.key] || data().academicRecords.some(r => r.year === t.year && r.term === t.term));
  $('history').innerHTML = terms.map(t => {
    const saved = data().academicRecords.find(r => r.year === t.year && r.term === t.term);
    const summary = history.find(r => r.year === t.year && r.term === t.term);
    const draft = data().drafts[t.key];
    const source = saved?.cgpaSource === 'calculated' ? 'Calculated' : 'Official';
    const status = summary ? `${source} CGPA ${summary.cgpa.toFixed(2)} · ${summary.standing}` :
      saved?.cgpaSource === 'calculated' ? 'Calculated CGPA pending earlier grades' :
      saved?.awaitingResult ? 'No CGPA yet' : saved ? 'No graded result' : 'Draft';
    const edit = t.order <= student().currentSemester ? `<button data-edit="${esc(t.key)}">Edit</button>` : '';
    return `<div class="list-row"><div><strong>${esc(t.label)}</strong><p>${esc(status)}${draft && saved ? ' · Draft edits' : ''}</p>
      <small>${(saved || draft).courses.map(c => esc(c.code) + ' (' + esc(c.grade) + ')').join(', ')}</small></div>${edit}</div>`;
  }).join('') || '<p class="empty">Your saved term results and drafts will appear here.</p>';
}

function requirements(course) {
  const prereqs = [...course.prerequisites, ...(course.altPrerequisites || [])];
  const info = ['Prerequisites: ' + (prereqs.join(course.altPrerequisites ? ' or ' : ', ') || 'None')];
  if (course.corequisites.length) info.push('Corequisite: ' + course.corequisites.join(', ') + ' (completed or in plan)');
  if (course.minEarnedCredits) info.push(course.minEarnedCredits + ' earned credits required');
  if (course.isElective) info.push(course.concentration + ' elective');
  return info;
}

function category(decision) {
  if (decision.canAdd) return 'available';
  if (decision.details.code === 'DUPLICATE') return 'planned';
  if (decision.details.code === 'ALREADY_COMPLETED') return 'completed';
  return 'blocked';
}

function courseCard(course, decision) {
  const state = category(decision);
  const labels = { available: 'Available', completed: 'Completed', planned: 'In plan', blocked: 'Blocked' };
  const button = state === 'planned' ? `<button data-remove="${course.code}">Remove from plan</button>` :
    decision.canAdd ? `<button data-add="${course.code}">Add to plan</button>` : '';
  return `<article class="panel course-card"><div class="section-line"><b class="code">${course.code}</b><span class="badge ${state}">${labels[state]}</span></div>
    <h3>${esc(course.title)}</h3><p class="hint">${termLabel(course)} · ${course.credits} credits</p>
    <div class="requirements">${requirements(course).map(line => `<p>${esc(line)}</p>`).join('')}</div>
    ${state === 'blocked' ? `<p class="reason">${esc(decision.reason)}</p>` : ''}${button}</article>`;
}

function renderCatalogue() {
  const ctx = SmartApp.getContext();
  const search = $('catalogue-search').value.trim().toLowerCase();
  const semester = $('catalogue-semester-filter').value;
  const status = $('catalogue-status').value;
  const results = [];
  for (const c of courses) {
    const matchesTerm = semester === 'all' || c.semester === Number(semester) ||
      (semester === 'internship' && c.isInternship) || (semester === 'elective' && c.isElective) ||
      (Number(semester) >= 7 && c.isElective && c.concentration === ctx.track);
    if (!matchesTerm || !(c.title.toLowerCase().includes(search) ||
        c.code.toLowerCase().replace(/\s/g, '').includes(search.replace(/\s/g, '')))) continue;
    const decision = SmartApp.evaluateCourseEligibility(c.code, ctx);
    if (!status || status === category(decision)) results.push(courseCard(c, decision));
  }
  $('catalogue-count').textContent = results.length + (results.length === 1 ? ' course' : ' courses');
  $('catalogue-list').innerHTML = results.join('') || '<p class="empty">No courses match these filters.</p>';
}

function courseDecision(prefix) {
  const c = findCourse($(prefix + '-course').value);
  const div = $(prefix + '-decision');
  const button = $(prefix + '-add');
  div.replaceChildren();
  button.disabled = true;
  if (!c) return;
  const decision = SmartApp.evaluateCourseEligibility(c.code);
  div.innerHTML = `<p class="hint">${esc(termLabel(c))} · ${esc(requirements(c).join(' · '))}</p>
    <p class="${decision.canAdd ? 'eligible' : 'reason'}">${esc(decision.reason)}</p>`;
  button.disabled = !decision.canAdd;
}

function changePlan(code, remove = false) {
  const res = SmartApp.changePlan(code, remove);
  renderView();
  notice(res.reason, !res.success);
}

function renderPlanner() {
  const { standing, completed, earned, prior, track } = SmartApp.getContext();
  const p = plan();
  $('plan-metrics').innerHTML = metric('Semester', student().currentSemester) + metric('Credit limit', standing.isPending ? 'Pending' : p.creditLimit) +
    metric('Planned credits', p.getTotalCredits()) + metric('Remaining credits', standing.isPending ? 'Pending' : p.getRemainingCredits());
  const issues = p.validateIntegrity(completed, earned, prior, track);
  $('plan-issues').innerHTML = (standing.isPending ? standingInfo() : '') +
    issues.map(issue => `<p class="callout warning">${esc(issue.reason)}</p>`).join('');
  const selected = p.getPlannedCourses();
  $('planned-list').innerHTML = selected.map(c => `<div class="list-row"><div><b class="code">${c.code}</b><h3>${esc(c.title)}</h3>
    <p>${c.credits} credits · ${termLabel(c)}</p></div><button data-remove="${c.code}">Remove</button></div>`).join('') || '<p class="empty">Your plan is empty. Select a course above to get started.</p>';
  $('clear-plan').disabled = !selected.length;
  $('save-plan').disabled = !selected.length || !!issues.length || standing.isPending;
  courseDecision('planner');
}

function renderAdvisor() {
  const ctx = SmartApp.getContext();
  const sem = student().currentSemester;
  const recommendations = courses.filter(c => SmartApp.evaluateCourseEligibility(c.code, ctx).canAdd).map(c => {
    const unlocks = CourseFP.findUnlockedCourses(c.code, courses, ctx.completed, ctx.track);
    return { c, unlocks, thisTerm: c.semester === sem || (sem >= 7 && c.isElective) };
  }).sort((a, b) => Number(b.thisTerm) - Number(a.thisTerm) || b.unlocks.length - a.unlocks.length || a.c.code.localeCompare(b.c.code));
  $('recommendations').innerHTML = recommendations.slice(0, 5).map(({c, unlocks, thisTerm}) => {
    const why = thisTerm ? 'Scheduled for your semester.' : 'Its requirements are satisfied.';
    const later = unlocks.length ? ' Fulfils a prerequisite for ' + unlocks.map(u => u.code).join(', ') + '.' : '';
    return `<article class="list-row"><div><b class="code">${c.code}</b><h3>${esc(c.title)}</h3><p>${why} ${c.credits} credits fit your plan.${esc(later)}</p></div>
      <button data-add="${c.code}">Add to plan</button></article>`;
  }).join('') || (ctx.standing.isPending ? standingInfo() : '<p class="empty">No eligible courses fit your remaining credits.</p>');
  courseDecision('advisor');
  const feedbackCourses = SmartApp.getFeedbackCourses();
  renderFeedbackCourses($('feedback-course').value, feedbackCourses);
  $('feedback-list').innerHTML = data().feedbackList.map(f => `<article class="feedback-entry"><strong>${esc(f.termCourse)}</strong>
    <small>Semester ${esc(f.semesterNumber)} · ${esc(new Date(f.submittedAt).toLocaleDateString())}</small>
    <p>Workload ${esc(f.workloadRating)}/5 · Advice helped: ${esc(f.advisingUseful)}</p>
    <p>Difficulties: ${esc(f.difficulties.join(', ') || 'Not answered')}</p>
    ${FEEDBACK_QUESTIONS.filter(q => f.responses?.[q.key]).map(q => `<p>${esc(q.label)} <b>${esc(f.responses[q.key])}</b></p>`).join('')}
    ${f.feedbackText ? `<p>${esc(f.feedbackText)}</p>` : ''}
    <div class="actions">${feedbackCourses.some(c => CourseFP.codesMatch(c.code, f.termCourse)) ?
      `<button type="button" data-feedback-edit="${esc(f.id)}">Edit</button>` : ''}
    <button type="button" data-feedback-delete="${esc(f.id)}">Delete</button></div></article>`
  ).join('') || '<p class="empty">Your submitted feedback will appear here.</p>';
}

function renderFeedbackCourses(selection, feedbackCourses = SmartApp.getFeedbackCourses()) {
  const original = data().feedbackList.find(f => f.id === editingFeedbackId);
  const editCourse = original && feedbackCourses.find(c => CourseFP.codesMatch(c.code, original.termCourse));
  if (editingFeedbackId && !editCourse) $('feedback').reset();
  const available = editCourse ? [editCourse] : feedbackCourses.filter(c => !c.reviewed);
  const select = $('feedback-course');
  select.innerHTML = option('', 'Choose a course') + available.map(c => option(c.code, c.code + ' · ' + c.title)).join('');
  select.value = editCourse?.code || (available.some(c => c.code === selection) ? selection : '');
  select.disabled = !!editCourse;
  $('feedback-fields').hidden = !available.length;
  $('save-feedback').disabled = !available.length;
  $('feedback-help').textContent = available.length ? 'One review per course. All questions are required.' :
    feedbackCourses.length ? 'You have already reviewed every eligible course in your academic record.' :
    'Save a term result with a course you took in Academic record to leave feedback.';
}

function editFeedback(id) {
  const entry = data().feedbackList.find(f => f.id === id);
  if (!entry) return;
  $('feedback').reset();
  editingFeedbackId = id;
  $('feedback-heading').textContent = 'Edit feedback';
  $('save-feedback').textContent = 'Save changes';
  $('cancel-feedback-edit').hidden = false;
  renderFeedbackCourses(entry.termCourse);
  $('workload').value = entry.workloadRating;
  $('useful').value = entry.advisingUseful;
  $('suggestions').value = entry.feedbackText || '';
  for (const q of FEEDBACK_QUESTIONS) $('feedback-' + q.key).value = entry.responses?.[q.key] || '';
  for (const box of $('difficulties').querySelectorAll('input')) box.checked = entry.difficulties.includes(box.value);
  validateDifficulties();
  $('feedback-materials').focus();
}

function validateDifficulties() {
  $('difficulties').querySelector('input').setCustomValidity($('difficulties').querySelector(':checked') ? '' :
    'Select at least one difficulty or choose None.');
}

function init() {
  $('grade-scale').innerHTML = Object.entries(GRADE_SCALE).map(([grade, g]) =>
    `<tr><th scope="row">${grade}</th><td>${g.marks || '—'}</td><td>${g.points?.toFixed(2) ?? '—'}</td><td>${esc(g.label)}</td></tr>`).join('');
  for (const group of ['additional-feedback', 'content-ratings', 'instructor-ratings']) {
    $(group).innerHTML = FEEDBACK_QUESTIONS.filter(q => (q.group || 'additional-feedback') === group).map(q => {
      const prompt = q.group ? 'Rate from 1 to 5' : 'Choose an answer';
      return `<label>${esc(q.label)}<select id="feedback-${q.key}" required>${option('', prompt) + q.choices.map(c => option(c, c)).join('')}</select></label>`;
    }).join('');
  }
  SmartApp.initStorage();
  const storageMessage = SmartApp.storageNotice();
  $('storage-notice').textContent = storageMessage;
  $('storage-notice').hidden = !storageMessage;
  for (const prefix of ['reg', 'profile']) {
    $(prefix + '-semester-select').innerHTML = termOptions;
    $(prefix + '-concentration-select').innerHTML = trackOptions;
    $(prefix + '-semester-select').onchange = () => configureTrack(prefix);
  }
  configureTrack('reg');
  $('catalogue-semester-filter').innerHTML = option('all', 'All semesters') + termOptions + option('internship', 'Internships') + option('elective', 'Concentration electives');
  const courseOptions = option('', 'Choose a course') + courses.map(c => option(c.code, courseLabel(c))).join('');
  for (const prefix of ['planner', 'advisor']) {
    $(prefix + '-course').innerHTML = courseOptions;
    $(prefix + '-course').onchange = () => courseDecision(prefix);
    $(prefix + '-add').onclick = () => changePlan($(prefix + '-course').value);
  }
  $('demo-list').innerHTML = SmartApp.DEFAULT_STUDENTS.map(d => `<div class="list-row"><div><strong>${esc(d.fullName)}</strong>
    <small>Semester ${d.currentSemester} · ${esc(d.audId)}</small></div><button data-demo="${d.internalId}" aria-label="Open ${esc(d.fullName)}, semester ${d.currentSemester}">Open</button></div>`).join('');
  $('new-tab').onclick = () => selectAuthMode(false);
  $('login-tab').onclick = () => selectAuthMode(true);
  $('signup').onsubmit = e => {
    e.preventDefault();
    const sem = Number($('reg-semester-select').value);
    enterAccount(SmartApp.register($('reg-full-name').value, $('reg-aud-id').value, sem, $('reg-concentration-select').value),
      sem > 1 || $('initial-cgpa').value === 'graded' ? 'records' : 'profile');
  };
  $('login').onsubmit = e => {
    e.preventDefault();
    enterAccount(SmartApp.login($('login-full-name').value, $('login-aud-id').value), 'profile');
  };
  $('sign-out').onclick = signOut;
  $('reset-demo').onclick = () => {
    if (confirm('Restore the five sample profiles to their original records and plans?')) {
      SmartApp.resetDemoData();
      notice('Sample profiles restored.');
    }
  };
  $('profile-settings').onsubmit = e => { e.preventDefault(); saveSettings(); };
  $('advance').onclick = () => {
    $('profile-semester-select').value = student().currentSemester + 1;
    configureTrack('profile');
    if (!$('profile-concentration-select').disabled && !$('profile-concentration-select').value) {
      notice('Choose your concentration and save settings to enter Semester 7.');
      $('profile-concentration-select').focus();
    } else if ($('profile-settings').reportValidity()) saveSettings();
  };
  $('record-term').onchange = () => { notice(); loadTerm(); };
  $('ungraded').onchange = toggleCgpa;
  $('cgpa-source').onchange = toggleCgpa;
  $('first-graded').onchange = $('record-courses').onchange = updateCalculation;
  $('select-term').onclick = () => {
    const suggested = suggestedCourses(currentTerm()).filter(c => !c.isElective);
    for (const row of $('record-courses').children) {
      if (suggested.some(c => c.code === row.dataset.code)) {
        row.querySelector('input').checked = true;
        row.querySelector('select').disabled = false;
      }
    }
    updateCalculation();
  };
  $('add-record-course').onclick = () => {
    const select = $('extra-course');
    const c = findCourse(select.value);
    if (!c) return;
    gradeRow(c, { grade: '' });
    updateCalculation();
    select.selectedOptions[0].remove();
    select.value = '';
  };
  $('term-form').onsubmit = e => { e.preventDefault(); saveRecord(true); };
  $('save-draft').onclick = () => saveRecord(false);
  $('catalogue-search').oninput = renderCatalogue;
  $('catalogue-semester-filter').onchange = $('catalogue-status').onchange = renderCatalogue;
  $('save-plan').onclick = () => { const res = SmartApp.savePlan(); notice(res.reason, !res.success); };
  $('clear-plan').onclick = () => {
    if (confirm('Remove all courses from this semester’s plan?')) {
      for (const code of plan().getPlannedCodes()) SmartApp.changePlan(code, true);
      renderPlanner();
      notice('Semester plan cleared.');
    }
  };
  $('difficulties').innerHTML = FEEDBACK_DIFFICULTIES.map(d =>
    `<label class="check"><input type="checkbox" value="${esc(d)}">${esc(d)}</label>`).join('');
  const firstDifficulty = $('difficulties').querySelector('input');
  const difficultyPrompt = 'Select at least one difficulty or choose None.';
  firstDifficulty.setCustomValidity(difficultyPrompt);
  $('difficulties').onchange = ({ target }) => {
    if (target.checked) {
      for (const box of $('difficulties').querySelectorAll('input:checked')) {
        if (box !== target && (target.value === 'None' || box.value === 'None')) box.checked = false;
      }
    }
    validateDifficulties();
  };
  $('suggestions').oninput = () => {
    const field = $('suggestions');
    field.setCustomValidity(field.value && !field.value.trim() ? 'Write a response to the improvement question.' : '');
  };
  $('feedback').onreset = () => {
    editingFeedbackId = null;
    $('feedback-heading').textContent = 'Course and advising feedback';
    $('save-feedback').textContent = 'Save feedback';
    $('cancel-feedback-edit').hidden = true;
    firstDifficulty.setCustomValidity(difficultyPrompt);
    $('suggestions').setCustomValidity('');
  };
  $('cancel-feedback-edit').onclick = () => {
    $('feedback').reset();
    renderAdvisor();
    notice('Edit cancelled.');
  };
  $('feedback').onsubmit = e => {
    e.preventDefault();
    const res = SmartApp.submitFeedback($('feedback-course').value, $('workload').value,
      Array.from($('difficulties').querySelectorAll(':checked'), c => c.value), $('useful').value, $('suggestions').value,
      Object.fromEntries(FEEDBACK_QUESTIONS.map(q => [q.key, $('feedback-' + q.key).value])), editingFeedbackId);
    if (!res.success) return notice(res.reason, true);
    const message = editingFeedbackId ? 'Feedback updated.' : 'Feedback saved to your account.';
    $('feedback').reset();
    renderAdvisor();
    notice(message);
  };
  document.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    const action = button.dataset;
    if (action.feedbackEdit) editFeedback(action.feedbackEdit);
    if (action.feedbackDelete) {
      const entry = data().feedbackList.find(f => f.id === action.feedbackDelete);
      if (!entry || !confirm('Delete your feedback for ' + entry.termCourse + ' from Semester ' + entry.semesterNumber + '?' +
        (findCourse(entry.termCourse) ? ' This course will remain closed to new reviews.' : ''))) return;
      const res = SmartApp.deleteFeedback(entry.id);
      if (!res.success) return notice(res.reason, true);
      if (editingFeedbackId === entry.id) $('feedback').reset();
      renderAdvisor();
      notice('Feedback deleted.');
    }
    if (action.demo) {
      const d = SmartApp.DEFAULT_STUDENTS.find(demo => demo.internalId === action.demo);
      enterAccount(SmartApp.login(d.fullName, d.audId), 'profile');
    }
    if (action.view) navigate(action.view);
    if (action.add) changePlan(action.add);
    if (action.remove) changePlan(action.remove, true);
    if (action.edit || action.missing) {
      navigate('records');
      $('record-term').value = action.edit || action.missing;
      loadTerm();
      $('record-term').focus();
    }
  });
  if (SmartApp.restoreSession()) { resetSemesterControls(); navigate('profile'); }
  else navigate('auth');
}
init();
