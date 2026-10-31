const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const portalSource = fs.readFileSync(path.join(__dirname, "../../portal/app.js"), "utf8");
const contentSource = fs.readFileSync(path.join(__dirname, "../../content.js"), "utf8");
const functionStart = portalSource.indexOf("async function handleCreateQuiz(e) {");
const functionEnd = portalSource.indexOf("\nasync function handleAddQuestion", functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, "teacher quiz handler must be present");
const functionSource = portalSource.slice(functionStart, functionEnd);

function createHarness(backendRequest) {
    const button = { disabled: false, textContent: "Create Quiz" };
    const values = {
        newQuizTitle: { value: "Biology" },
        newQuizDescription: { value: "Cell structure" },
        newQuizDuration: { value: "40" },
        newQuizActive: { checked: true },
        teacherQuizSelect: { value: "" }
    };
    let reset = false;
    let busy = false;
    const form = {
        querySelector: () => button,
        setAttribute: () => { busy = true; },
        removeAttribute: () => { busy = false; },
        reset: () => { reset = true; }
    };
    const state = { toasts: [], loaded: 0 };
    const context = {
        backendRequest,
        loadTeacherQuizzes: async () => { state.loaded += 1; },
        showToast: (...args) => state.toasts.push(args),
        document: { getElementById: id => values[id] }
    };
    vm.runInNewContext(`${functionSource}\nglobalThis.handleCreateQuiz = handleCreateQuiz;`, context);
    return { handleCreateQuiz: context.handleCreateQuiz, button, values, form, state, wasReset: () => reset, isBusy: () => busy };
}

test("teacher quiz form resets and selects the created quiz after the async request", async () => {
    let completeRequest;
    const requestPromise = new Promise(resolve => { completeRequest = resolve; });
    const calls = [];
    const harness = createHarness((...args) => { calls.push(args); return requestPromise; });
    let eventIsDispatching = true;
    const event = {
        preventDefault() {},
        get currentTarget() { return eventIsDispatching ? harness.form : null; }
    };

    const operation = harness.handleCreateQuiz(event);
    eventIsDispatching = false;
    assert.equal(harness.button.disabled, true);
    assert.equal(harness.button.textContent, "Creating quiz…");
    assert.equal(harness.isBusy(), true);

    completeRequest({ quiz: { id: 73 } });
    await operation;

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "/api/quizzes");
    assert.deepEqual(JSON.parse(calls[0][1].body), {
        title: "Biology",
        description: "Cell structure",
        duration_minutes: 40,
        is_active: true
    });
    assert.equal(harness.wasReset(), true);
    assert.equal(harness.values.teacherQuizSelect.value, "73");
    assert.equal(harness.values.newQuizDuration.value, "15");
    assert.equal(harness.state.loaded, 1);
    assert.deepEqual(harness.state.toasts, [["success", "Quiz created. Add its questions below."]]);
    assert.equal(harness.button.disabled, false);
    assert.equal(harness.button.textContent, "Create Quiz");
    assert.equal(harness.isBusy(), false);
});

test("teacher quiz form keeps entered values and restores the button after a failed request", async () => {
    const harness = createHarness(async () => { throw new Error("Quiz title already exists."); });
    let eventIsDispatching = true;
    const event = {
        preventDefault() {},
        get currentTarget() { return eventIsDispatching ? harness.form : null; }
    };

    const operation = harness.handleCreateQuiz(event);
    eventIsDispatching = false;
    await operation;

    assert.equal(harness.wasReset(), false);
    assert.equal(harness.values.newQuizTitle.value, "Biology");
    assert.deepEqual(harness.state.toasts, [["error", "Quiz title already exists."]]);
    assert.equal(harness.button.disabled, false);
    assert.equal(harness.button.textContent, "Create Quiz");
    assert.equal(harness.isBusy(), false);
});

test("portal navigation resolves every named page, including exam and results", () => {
    const start = portalSource.indexOf("function showPage(pageId) {");
    const end = portalSource.indexOf("\nfunction setupEventListeners", start);
    assert.ok(start >= 0 && end > start, "portal page navigation must be present");
    const pageFunction = portalSource.slice(start, end);
    const pageIds = ["loginPage", "studentDashboard", "teacherDashboard", "quizPage", "resultPage"];
    const pages = pageIds.map(id => {
        const classes = new Set(id.endsWith("Dashboard") || id === "quizPage" || id === "resultPage" ? ["hidden"] : []);
        return {
            id,
            classes,
            style: {},
            classList: {
                add: name => classes.add(name),
                remove: name => classes.delete(name),
                contains: name => classes.has(name)
            }
        };
    });
    const context = {
        AppState: {},
        console: { log() {}, error() {} },
        document: {
            querySelectorAll: () => pages,
            getElementById: id => pages.find(page => page.id === id) || null
        }
    };
    vm.runInNewContext(`${pageFunction}\nglobalThis.showPage = showPage;`, context);

    for (const [name, id] of Object.entries({
        login: "loginPage",
        student: "studentDashboard",
        teacher: "teacherDashboard",
        quiz: "quizPage",
        result: "resultPage"
    })) {
        context.showPage(name);
        const visible = pages.filter(page => page.classList.contains("active"));
        assert.deepEqual(visible.map(page => page.id), [id]);
        assert.equal(context.AppState.currentPage, name);
    }
});

test("question option form sends a string array and a valid zero-based correct index", () => {
    const options = ["Paris", "New Delhi", "Tokyo"];
    const select = { value: "1" };
    const context = {
        document: {
            querySelectorAll: selector => selector === ".question-option-input" ? options.map(value => ({ value })) : [],
            getElementById: id => id === "newCorrectAnswer" ? select : null
        }
    };
    const start = portalSource.indexOf("function readQuestionOptions() {");
    const end = portalSource.indexOf("\nasync function handleAddQuestion", start);
    assert.ok(start >= 0 && end > start, "question options validation must be present");
    vm.runInNewContext(`${portalSource.slice(start, end)}\nglobalThis.readQuestionOptions = readQuestionOptions;`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.readQuestionOptions())), {
        options: ["Paris", "New Delhi", "Tokyo"], correct_answer: 1
    });
    options[1] = " ";
    assert.throws(() => context.readQuestionOptions(), /non-empty options/);
    options[1] = "New Delhi";
    select.value = "9";
    assert.throws(() => context.readQuestionOptions(), /Choose the correct answer/);
});

test("teacher question form uses individual option rows instead of a newline textarea", () => {
    const portalHtml = fs.readFileSync(path.join(__dirname, "../../portal/index.html"), "utf8");
    assert.match(portalHtml, /id="questionOptionRows"/);
    assert.match(portalHtml, /id="addQuestionOption"/);
    assert.doesNotMatch(portalHtml, /id="newQuestionOptions"/);
});

test("fullscreen request waits for Chrome before the quiz proceeds", async () => {
    const document = { fullscreenElement: null, documentElement: null };
    const element = { requestFullscreen: async () => { document.fullscreenElement = element; } };
    document.documentElement = element;
    const start = portalSource.indexOf("function isPortalFullscreen() {");
    const end = portalSource.indexOf("\nfunction playViolationSound", start);
    assert.ok(start >= 0 && end > start, "fullscreen helper must be present");
    const context = { document };
    vm.runInNewContext(`${portalSource.slice(start, end)}\nglobalThis.enterPortalFullscreen = enterPortalFullscreen; globalThis.isPortalFullscreen = isPortalFullscreen;`, context);
    assert.equal(context.isPortalFullscreen(), false);
    await context.enterPortalFullscreen();
    assert.equal(context.isPortalFullscreen(), true);

    document.fullscreenElement = null;
    element.requestFullscreen = async () => { throw new Error("permission denied"); };
    await assert.rejects(context.enterPortalFullscreen(), /permission denied/);
});

test("previous and next navigation remain available and disable only at the ends", () => {
    const controls = Object.fromEntries(["prevBtn", "nextBtn", "submitBtn"].map(id => [id, { style: {}, disabled: false }]));
    const start = portalSource.indexOf("function updateNavigationButtons() {");
    const end = portalSource.indexOf("\nfunction startTimer", start);
    assert.ok(start >= 0 && end > start, "question navigation controls must be present");
    const context = {
        QuizState: { currentQuestion: 0, questions: Array.from({ length: 10 }) },
        document: { getElementById: id => controls[id] }
    };
    vm.runInNewContext(`${portalSource.slice(start, end)}\nglobalThis.updateNavigationButtons = updateNavigationButtons;`, context);
    context.updateNavigationButtons();
    assert.equal(controls.prevBtn.style.display, "flex");
    assert.equal(controls.prevBtn.disabled, true);
    assert.equal(controls.nextBtn.style.display, "flex");
    assert.equal(controls.nextBtn.disabled, false);
    assert.equal(controls.submitBtn.style.display, "none");
    context.QuizState.currentQuestion = 9;
    context.updateNavigationButtons();
    assert.equal(controls.prevBtn.disabled, false);
    assert.equal(controls.nextBtn.style.display, "flex");
    assert.equal(controls.nextBtn.disabled, true);
    assert.equal(controls.submitBtn.style.display, "flex");
});

test("question navigation switches in both directions and does not wrap", () => {
    const loaded = [];
    const context = { QuizState: { currentQuestion: 0, questions: Array.from({ length: 3 }) }, loadQuestion: index => loaded.push(index) };
    const start = portalSource.indexOf("function nextQuestion() {");
    const end = portalSource.indexOf("\nfunction updateProgress", start);
    assert.ok(start >= 0 && end > start, "previous and next handlers must be present");
    vm.runInNewContext(`${portalSource.slice(start, end)}\nglobalThis.nextQuestion = nextQuestion; globalThis.previousQuestion = previousQuestion;`, context);
    context.previousQuestion();
    context.nextQuestion();
    context.QuizState.currentQuestion = 1;
    context.nextQuestion();
    context.QuizState.currentQuestion = 2;
    context.nextQuestion();
    context.previousQuestion();
    assert.deepEqual(loaded, [1, 2, 1]);
});

test("a delayed answer save stays attached to its original question after navigating", async () => {
    let completeSave;
    const state = { currentQuestion: 0, isSubmitted: false, attemptId: 99, questions: [{ id: 10 }, { id: 20 }], answers: [null, null] };
    const context = {
        QuizState: state,
        backendRequest: () => new Promise(resolve => { completeSave = resolve; }),
        document: { querySelectorAll: () => [], querySelector: () => null },
        updateQuestionPalette() {},
        showToast() {}
    };
    const start = portalSource.indexOf("async function selectOption(optionIndex) {");
    const end = portalSource.indexOf("\nfunction nextQuestion", start);
    assert.ok(start >= 0 && end > start, "answer saving handler must be present");
    vm.runInNewContext(`${portalSource.slice(start, end)}\nglobalThis.selectOption = selectOption;`, context);
    const save = context.selectOption(2);
    state.currentQuestion = 1;
    completeSave({ answer: { selected_option: 2 } });
    await save;
    assert.deepEqual(state.answers, [2, null]);
});

test("screenshot shortcut mapping catches Mac key codes and Print Screen variants", () => {
    const start = contentSource.indexOf("function isScreenshotShortcut(event) {");
    const end = contentSource.indexOf("\n  // ---------------- Best-effort Screenshot Shortcut Detection", start);
    assert.ok(start >= 0 && end > start, "screenshot shortcut detection must be present");
    const context = {};
    vm.runInNewContext(`${contentSource.slice(start, end)}\nglobalThis.isScreenshotShortcut = isScreenshotShortcut;`, context);
    for (const [code, key] of [["Digit3", "#"], ["Digit4", "$"], ["Digit5", "%"]]) {
        assert.equal(context.isScreenshotShortcut({ metaKey: true, shiftKey: true, code, key }), true);
    }
    assert.equal(context.isScreenshotShortcut({ key: "PrintScreen" }), true);
    assert.equal(context.isScreenshotShortcut({ code: "PrintScreen", key: "" }), true);
    assert.equal(context.isScreenshotShortcut({ metaKey: false, shiftKey: true, code: "Digit3", key: "#" }), false);
    assert.equal(context.isScreenshotShortcut({ key: "a", code: "KeyA" }), false);
    assert.match(contentSource, /window\.addEventListener\("keydown",\s*\(event\)\s*=>\s*\{\s*if\s*\(isScreenshotShortcut\(event\)\)/);
});

test("portal reports a received screenshot shortcut to its backend violation flow", () => {
    const start = portalSource.indexOf("function handleKeyboardShortcuts(e) {");
    const end = portalSource.indexOf("\nfunction handleFullscreenChange", start);
    assert.ok(start >= 0 && end > start, "portal screenshot keyboard handling must be present");
    const reports = [];
    const context = {
        QuizState: { quizInProgress: true, isSubmitted: false },
        lastScreenshotShortcutAt: 0,
        recordViolation: (...args) => reports.push(args)
    };
    vm.runInNewContext(`${portalSource.slice(start, end)}\nglobalThis.handleKeyboardShortcuts = handleKeyboardShortcuts;`, context);
    context.handleKeyboardShortcuts({ metaKey: true, shiftKey: true, code: "Digit4", key: "$", repeat: false });
    context.handleKeyboardShortcuts({ metaKey: true, shiftKey: true, code: "Digit4", key: "$", repeat: false });
    assert.equal(reports.length, 1);
    assert.equal(reports[0][0], "screenshot_attempt");
    assert.match(portalSource, /window\.addEventListener\('keydown', handleKeyboardShortcuts, true\)/);
});

test("student results separate incorrect answers from unanswered questions", () => {
    const start = portalSource.indexOf("function showResults(score, percentage) {");
    const end = portalSource.indexOf("\nfunction retakeQuiz", start);
    assert.ok(start >= 0 && end > start, "student result renderer must be present");
    const ids = ["finalScore", "scorePercentage", "correctAnswers", "incorrectAnswers", "unattemptedQuestions", "finalViolations", "timeTaken", "quizStatus"];
    const elements = Object.fromEntries(ids.map(id => [id, { textContent: "" }]));
    const context = {
        QuizState: {
            questions: Array.from({ length: 5 }), answers: [1, 0, null, 2, null],
            violationCount: 0, startTime: new Date(0), endTime: new Date(60000),
            isAutoSubmitted: false, maxViolations: 3
        },
        document: { getElementById: id => elements[id] }, showPage: () => {}
    };
    vm.runInNewContext(`${portalSource.slice(start, end)}\nglobalThis.showResults = showResults;`, context);
    context.showResults(2, 40);
    assert.equal(elements.correctAnswers.textContent, 2);
    assert.equal(elements.incorrectAnswers.textContent, 1);
    assert.equal(elements.unattemptedQuestions.textContent, 2);
    assert.match(portalSource, /Not attempted: \$\{unansweredCount\} · Incorrect:/);
});

test("teacher monitoring exposes marks and time taken, and Details opens the detail panel", () => {
    const durationStart = portalSource.indexOf("function formatElapsedDuration(start, end) {");
    const durationEnd = portalSource.indexOf("\nfunction renderAnalytics", durationStart);
    assert.ok(durationStart >= 0 && durationEnd > durationStart, "duration formatter must be present");
    const context = {};
    vm.runInNewContext(`${portalSource.slice(durationStart, durationEnd)}\nglobalThis.formatElapsedDuration = formatElapsedDuration;`, context);
    assert.equal(context.formatElapsedDuration("2026-10-31T10:00:00Z", "2026-10-31T10:02:05Z"), "2m 5s");
    assert.match(portalSource, /data-attempt-detail="\$\{Number\(attempt\.id\)\}"/);
    assert.match(portalSource, /panel\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
    assert.match(portalSource, /Number\(attempt\.score\)\} \/ \$\{Number\(attempt\.question_count\)/);
    assert.match(portalSource, /Time taken: \$\{duration\} · Marks: \$\{marks\}/);
    assert.match(fs.readFileSync(path.join(__dirname, "../controllers/attemptController.js"), "utf8"), /q\.duration_minutes, a\.attempt_number/);
});

test("quiz controls stay visible at the bottom while navigating", () => {
    const portalHtml = fs.readFileSync(path.join(__dirname, "../../portal/index.html"), "utf8");
    const styles = fs.readFileSync(path.join(__dirname, "../../portal/styles.css"), "utf8");
    assert.match(portalHtml, /id="prevBtn"[^>]*aria-label="Go to the previous question"/);
    assert.match(portalHtml, /id="nextBtn"[^>]*aria-label="Go to the next question"/);
    assert.match(styles, /\.question-controls\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);
});
