// ── CONFIG ──
let PRINTERS = [];
const START_HOUR = 7;
const END_HOUR = 17;
let HOUR_H = 64; // kept in sync with --hour-h; scaled dynamically to fill screen

// ── STATE ──
let bookings = [];
let filaments = [];
let classes = [];
let printers = [];
let selectedSlots = new Set();
let selectedBlockSlots = new Set();
let currentDate = todayStr();
let editingBookingId = null;
let editingBlockId = null;
let startSlot = null;
let editStartSlot = null;
let blockStartSlot = null;

// Auth state
let currentUser = { loggedIn: false, username: null, fullName: null, isAdmin: false, isKiosk: false, loginMode: null };
let autoLogoutTimer = null;
const isOffline = false; // offline mode is disabled


// Settings state
let settingsFilaments = [];
let settingsClasses = [];
let settingsPrinters = [];
let settingsAdmins = [];
let selectedFilamentIdx = -1;
let selectedClassIdx = -1;
let selectedPrinterIdx = -1;
let selectedAdminIdx = -1;
let dragSrcIdx = null;

function aestDateStr(offsetDays = 0) {
    // AEST = UTC+10 (no DST adjustment — scheduler is for a fixed Queensland timezone)
    const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

function todayStr()        { return aestDateStr(0); }
function maxBookingDateStr() { return aestDateStr(7); }

// ── DATE CHANGE DETECTION ──
const PAGE_DATE = todayStr(); // captured at load time

function checkDateRollover() {
    if (todayStr() !== PAGE_DATE) location.reload();
}

// Check on wake from sleep / tab becoming visible
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDateRollover();
});

// Fallback: check every minute in case visibilitychange doesn't fire
setInterval(checkDateRollover, 60_000);

// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
    const today = todayStr();
    const maxDate = maxBookingDateStr();

    // Main date picker: can view any past date, but not beyond 7 days ahead
    const datePicker = document.getElementById("selectedDate");
    datePicker.max = maxDate;
    datePicker.value = currentDate;

    // Booking modal date picker: today → today+7 only
    document.getElementById("bookingDate").min = today;
    document.getElementById("bookingDate").max = maxDate;
    document.getElementById("bookingDate").value = currentDate;

    updateCreateBtn();

    datePicker.addEventListener("change", e => {
        currentDate = e.target.value;
        updateCreateBtn();
        loadBookings();
    });

    // Shift key tracker — only active when no modal is open
    document.addEventListener("keydown", e => {
        if (e.key === "Shift" && !document.querySelector(".modal-overlay.open"))
            document.body.classList.add("shift-on");
    });
    document.addEventListener("keyup", e => {
        if (e.key === "Shift") document.body.classList.remove("shift-on");
    });

    document.getElementById("blockBtn").addEventListener("click", openBlockModal);

    document.getElementById("openModalBtn").addEventListener("click", e => {
        if (!currentUser.loggedIn) { showBottomMsg("Please sign in to make a booking."); return; }
        const missing = [];
        if (filaments.length === 0) missing.push("filaments");
        if (classes.length === 0) missing.push("classes");
        if (missing.length > 0) {
            showBottomMsg(currentUser.isAdmin
                ? `Please add ${missing.join(" and ")} in Settings before creating a booking.`
                : `Please ask an admin to add ${missing.join(" and ")} before creating a booking.`);
            return;
        }
        openBookingModal();
    });
    document.getElementById("closeModalBtn").addEventListener("click", closeBookingModal);
    document.getElementById("cancelBtn").addEventListener("click", closeBookingModal);
    document.getElementById("submitBtn").addEventListener("click", submitBooking);
    document.getElementById("weightInput").addEventListener("input", updatePrice);
    document.getElementById("filamentType").addEventListener("change", updatePrice);

    // Duration inputs — fire on blur or Enter
    const totalTimeInput = document.getElementById("totalTimeDisplay");
    totalTimeInput.addEventListener("change", () => applyDuration(totalTimeInput.value));
    totalTimeInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyDuration(totalTimeInput.value); } });

    const editTotalTimeInput = document.getElementById("editTotalTimeDisplay");
    editTotalTimeInput.addEventListener("change", () => applyEditDuration(editTotalTimeInput.value));
    editTotalTimeInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyEditDuration(editTotalTimeInput.value); } });

    document.getElementById("printerSelect").addEventListener("change", refreshTimeslots);
    document.getElementById("bookingDate").addEventListener("change", refreshTimeslots);
    document.getElementById("bookingModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("bookingModalOverlay")) closeBookingModal();
    });

    // Edit modal
    document.getElementById("editCloseBtn").addEventListener("click", closeEditModal);
    document.getElementById("editCancelBtn").addEventListener("click", closeEditModal);
    document.getElementById("editSaveBtn").addEventListener("click", saveEdit);
    document.getElementById("editDeleteBtn").addEventListener("click", deleteBooking);
    document.getElementById("editWeightInput").addEventListener("input", updateEditPrice);
    document.getElementById("editFilamentType").addEventListener("change", updateEditPrice);
    document.getElementById("editModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("editModalOverlay")) closeEditModal();
    });

    // Settings modal
    document.getElementById("settingsBtn").addEventListener("click", openSettings);
    document.getElementById("settingsCloseBtn").addEventListener("click", closeSettings);
    document.getElementById("settingsCancelBtn").addEventListener("click", closeSettings);
    document.getElementById("settingsSaveBtn").addEventListener("click", saveSettings);
    document.getElementById("settingsModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("settingsModalOverlay")) closeSettings();
    });

    // Tab switching
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    // Filament add/remove
    document.getElementById("addFilamentBtn").addEventListener("click", addFilament);
    document.getElementById("removeFilamentBtn").addEventListener("click", removeFilament);
    document.getElementById("editFilamentBtn").addEventListener("click", editFilament);

    // Class add/remove
    document.getElementById("addClassBtn").addEventListener("click", addClass);
    document.getElementById("removeClassBtn").addEventListener("click", removeClass);

    // Printer add/rename/remove
    document.getElementById("addPrinterBtn").addEventListener("click", addPrinter);
    document.getElementById("editPrinterBtn").addEventListener("click", editPrinter);
    document.getElementById("removePrinterBtn").addEventListener("click", removePrinter);

    // Stats modal
    document.getElementById("statsCloseBtn").addEventListener("click", closeStatsModal);
    document.getElementById("statsModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("statsModalOverlay")) closeStatsModal();
    });
    document.getElementById("statsClass").addEventListener("change", fetchStats);
    document.getElementById("statsFrom").addEventListener("change", fetchStats);
    document.getElementById("statsTo").addEventListener("change", fetchStats);

    // List modal — shift+click logo, admin only
    document.getElementById("topbarLogo").addEventListener("click", e => { if (e.shiftKey && currentUser.isAdmin) openListModal(); });
    document.getElementById("listCloseBtn").addEventListener("click", closeListModal);
    document.getElementById("listSearch").addEventListener("input", e => filterListModal(e.target.value));
    document.getElementById("listModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("listModalOverlay")) closeListModal();
    });

    // Block modal
    document.getElementById("blockCloseBtn").addEventListener("click", closeBlockModal);
    document.getElementById("blockCancelBtn").addEventListener("click", closeBlockModal);
    document.getElementById("blockSubmitBtn").addEventListener("click", submitBlock);
    document.getElementById("blockDeleteBtn").addEventListener("click", deleteBlock);
    document.getElementById("blockPrinterSelect").addEventListener("change", refreshBlockTimeslots);
    document.getElementById("blockDate").addEventListener("change", refreshBlockTimeslots);
    document.getElementById("blockModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("blockModalOverlay")) closeBlockModal();
    });

    // Hamburger menu
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const topbarMenu   = document.getElementById("topbarMenu");
    hamburgerBtn.addEventListener("click", e => {
        e.stopPropagation();
        topbarMenu.classList.toggle("open");
    });
    // Close menu when any button/input inside is interacted with
    topbarMenu.addEventListener("click", e => {
        if (e.target !== topbarMenu) topbarMenu.classList.remove("open");
    });
    // Close on outside click
    document.addEventListener("click", e => {
        if (!topbarMenu.contains(e.target) && e.target !== hamburgerBtn)
            topbarMenu.classList.remove("open");
    });
    // Watch topbar width and collapse into hamburger when content would overflow
    new ResizeObserver(updateTopbarLayout).observe(document.querySelector(".topbar"));
    new ResizeObserver(updateHourHeight).observe(document.querySelector(".scheduler-scroll"));

    // PIN modal
    document.getElementById("pinBtn").addEventListener("click", openPinModal);
    document.getElementById("pinCloseBtn").addEventListener("click", closePinModal);
    document.getElementById("pinCancelBtn").addEventListener("click", closePinModal);
    document.getElementById("pinSubmitBtn").addEventListener("click", submitPin);
    document.getElementById("pinModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("pinModalOverlay")) closePinModal();
    });
    document.getElementById("exitPinAdminBtn").addEventListener("click", exitPinAdmin);
    document.getElementById("savePinBtn").addEventListener("click", savePin);
    setupPinDigits();

    // Login modal
    document.getElementById("loginBtn").addEventListener("click", openLoginModal);
    document.getElementById("loginCloseBtn").addEventListener("click", closeLoginModal);
    document.getElementById("loginCancelBtn").addEventListener("click", closeLoginModal);
    document.getElementById("loginSubmitBtn").addEventListener("click", submitLogin);
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("loginModalOverlay").addEventListener("click", e => {
        if (e.target === document.getElementById("loginModalOverlay")) closeLoginModal();
    });
    document.getElementById("loginPassword").addEventListener("keydown", e => {
        if (e.key === "Enter") submitLogin();
    });

    // Stats (now admin-only, no shift required)
    document.getElementById("statsBtn").addEventListener("click", openStatsModal);

    // Admin settings
    document.getElementById("addAdminBtn").addEventListener("click", addAdmin);
    document.getElementById("removeAdminBtn").addEventListener("click", removeAdmin);

    setupAutocomplete();

    // Setup modal
    setupSetupModal();

    await Promise.all([loadFilaments(), loadClasses(), loadPrinters(), loadCurrentUser()]);
    buildTimeslotGrid();
    updateHourHeight();
    loadBookings();

    applyPrefillFromUrl();
});

// ── DATA LOADING ──
async function loadBookings() {
    try {
        const resp = await fetch(`/Index?handler=Bookings&date=${currentDate}`);
        bookings = await resp.json();
    } catch { bookings = []; }
    renderGrid();
}

async function loadFilaments() {
    try {
        const resp = await fetch("/Index?handler=Filaments");
        filaments = await resp.json();
    } catch { filaments = []; }
    populateFilamentDropdown();
    populateEditFilamentDropdown();
}

async function loadClasses() {
    try {
        const resp = await fetch("/Index?handler=Classes");
        classes = await resp.json();
    } catch { classes = []; }
    populateClassDropdown();
    populateEditClassDropdown();
}

async function loadPrinters() {
    try {
        const resp = await fetch("/Index?handler=Printers");
        printers = await resp.json();
    } catch { printers = []; }
    PRINTERS = printers.map(p => p.name);
    populatePrinterDropdowns();
    updateNoPrintersWarning();
}

function populatePrinterDropdowns() {
    ["printerSelect", "editPrinterSelect", "blockPrinterSelect"].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '<option value="" disabled selected>Select Printer</option>';
        PRINTERS.forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
        if (prev && PRINTERS.includes(prev)) sel.value = prev;
    });
}

function updateNoPrintersWarning() {
    const warn = document.getElementById("noPrintersWarning");
    const scroll = document.querySelector(".scheduler-scroll");
    if (PRINTERS.length === 0) {
        warn.style.display = "flex";
        scroll.style.display = "none";
        document.getElementById("noPrintersAdminMsg").style.display = currentUser.isAdmin ? "" : "none";
        document.getElementById("noPrintersUserMsg").style.display  = currentUser.isAdmin ? "none" : "";
    } else {
        warn.style.display = "none";
        scroll.style.display = "";
    }
}

function populateFilamentDropdown() {
    const sel = document.getElementById("filamentType");
    const prev = sel.value;
    sel.innerHTML = "";
    filaments.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.name;
        opt.textContent = f.name;
        sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
}

function populateEditFilamentDropdown() {
    const sel = document.getElementById("editFilamentType");
    const prev = sel.value;
    sel.innerHTML = "";
    filaments.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.name;
        opt.textContent = f.name;
        sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
}

function populateClassDropdown() {
    const sel = document.getElementById("studentClass");
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select Class</option>';
    classes.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = c.name;
        sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
}

function populateEditClassDropdown() {
    const sel = document.getElementById("editStudentClass");
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select Class</option>';
    classes.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = c.name;
        sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
}

// ── GRID RENDERING ──
function renderGrid() {
    const wrap = document.getElementById("gridWrap");
    wrap.style.setProperty("--printer-count", PRINTERS.length);
    wrap.innerHTML = "";

    wrap.appendChild(makeEl("div", "col-header-spacer"));
    PRINTERS.forEach(p => {
        const h = makeEl("div", "col-header");
        h.textContent = p;
        wrap.appendChild(h);
    });

    // Measure the actual rendered header height so blocks align precisely
    const headerHeight = wrap.querySelector(".col-header")?.offsetHeight ?? 40;

    for (let hour = START_HOUR; hour < END_HOUR; hour++) {
        const tl = makeEl("div", "time-label-cell");
        tl.textContent = formatTime12(`${pad(hour)}:00`);
        wrap.appendChild(tl);
        PRINTERS.forEach(() => wrap.appendChild(makeEl("div", "printer-col-cell")));
    }

    bookings.filter(b => b.date === currentDate).forEach(b => placeBlock(wrap, b, headerHeight));
}

function placeBlock(wrap, b, headerHeight = 40) {
    const printerIdx = PRINTERS.indexOf(b.printerName);
    if (printerIdx < 0) return;

    const startMins = timeToMins(b.startTime);
    const endMins = timeToMins(b.endTime);
    const dMins = endMins - startMins;
    const topPx = ((startMins - START_HOUR * 60) / 60) * HOUR_H + headerHeight;
    const heightPx = (dMins / 60) * HOUR_H - 2;

    // Blocks <= 90 mins get hover-expand behaviour
    const isShort = dMins < 90;

    const block = document.createElement("div");
    block.className = "booking-block" + (isShort ? " expandable" : "");
    const colors = { booking: "#3a8fd9", maintenance: "#888888", outoforder: "#c0392b", unavailable: "#4a3a8c" };
    block.style.background = colors[b.bookingType] || "#3a8fd9";
    block.style.top = `${topPx}px`;
    block.style.height = `${heightPx}px`;
    block.style.left = `calc(var(--time-col) + ${printerIdx} * ((100% - var(--time-col)) / ${PRINTERS.length}) + 3px)`;
    block.style.width = `calc((100% - var(--time-col)) / ${PRINTERS.length} - 6px)`;
    // Store natural height for collapse
    block.dataset.naturalHeight = heightPx;

    const dLabel = dMins % 60 === 0 ? `${dMins / 60}h` : `${Math.floor(dMins / 60)}h${dMins % 60}m`;

    if (b.bookingType === "booking") {
        const isPastDay = b.date < todayStr();
        const canEdit = currentUser.loggedIn && (
            currentUser.isAdmin ||
            (!isPastDay && (currentUser.isSharedMode || b.studentName === currentUser.fullName))
        );
        block.innerHTML = `
            <strong>${escHtml(b.studentName)}</strong>
            <span class="bk-sub">${escHtml(b.studentClass)}</span>
            <span class="bk-time">${formatTime12(b.startTime)}–${formatTime12(b.endTime)} (${dLabel})</span>
            <span><strong class="bk-filament">${escHtml(b.filamentType)}</strong><span class="bk-dot"> · </span><span class="bk-detail">${(+b.weightGrams).toFixed(2)}g</span></span>
            <span class="bk-price">$${(+b.price).toFixed(2)}</span>
            ${canEdit ? `<button class="bk-edit-btn" title="Edit booking" data-id="${b.id}">✎</button>` : ""}`;

        if (canEdit) {
            block.querySelector(".bk-edit-btn").addEventListener("click", ev => {
                ev.stopPropagation();
                openEditModal(b.id);
            });
        }
    } else {
        const typeLabels = { maintenance: "Maintenance", outoforder: "Out of Order", unavailable: "Block Printing" };
        const label = typeLabels[b.bookingType] || "Printer Unavailable";
        block.classList.add("block-type");
        block.innerHTML = `
            <strong>${label}</strong>
            <span class="bk-time">${formatTime12(b.startTime)}–${formatTime12(b.endTime)} (${dLabel})</span>
            ${currentUser.isAdmin ? `<button class="bk-edit-btn" title="Edit block" data-id="${b.id}">✎</button>` : ""}`;
        if (currentUser.isAdmin) {
            block.querySelector(".bk-edit-btn").addEventListener("click", ev => {
                ev.stopPropagation();
                openEditBlockModal(b.id);
            });
        }
    }

    // Hover expand for short blocks
    if (isShort) {
        let expandTimer = null;
        block.addEventListener("mouseenter", () => {
            expandTimer = setTimeout(() => {
                // Expand to show all content — measure scroll height
                block.style.height = "auto";
                const full = block.scrollHeight;
                block.style.height = `${heightPx}px`;
                // Force reflow then animate
                block.offsetHeight;
                block.style.height = `${Math.max(full, heightPx)}px`;
                block.style.zIndex = "20";
                block.style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)";
                block.classList.add("expanded");
            }, 120);
        });
        block.addEventListener("mouseleave", () => {
            clearTimeout(expandTimer);
            block.style.height = `${heightPx}px`;
            block.style.zIndex = "5";
            block.style.boxShadow = "";
            block.classList.remove("expanded");
        });
    }

    wrap.appendChild(block);
}

// ── TIMESLOTS ──
function buildTimeslotGrid() {
    const grid = document.getElementById("timeslotGrid");
    grid.innerHTML = "";
    for (let h = START_HOUR; h < END_HOUR; h++) {
        for (const m of [0, 30]) {
            const s = `${pad(h)}:${pad(m)}`;
            const btn = document.createElement("button");
            btn.className = "slot-btn";
            btn.textContent = formatTime12(s);
            btn.dataset.slot = s;
            btn.addEventListener("click", () => bookingSlotClick(btn, s));
            grid.appendChild(btn);
        }
    }
}

function refreshTimeslots() {
    const printer = document.getElementById("printerSelect").value;
    const date = document.getElementById("bookingDate").value;
    document.getElementById("timeslotOverlay").classList.toggle("hidden", !!printer);
    const taken = getBlockedSlots(printer, date);
    startSlot = null;
    selectedSlots.clear();
    document.querySelectorAll("#timeslotGrid .slot-btn").forEach(btn => {
        btn.classList.remove("blocked", "selected");
        if (taken.has(btn.dataset.slot)) btn.classList.add("blocked");
    });
    const durationInput = document.getElementById("totalTimeDisplay");
    durationInput.value = "00:00";
    durationInput.disabled = true;
    updatePrice();
}

function getBlockedSlots(printer, date, excludeId = null) {
    const blocked = new Set();
    if (!printer || !date) return blocked;
    bookings
        .filter(b => b.printerName === printer && b.date === date && b.id !== excludeId)
        .forEach(b => {
            let cur = timeToMins(b.startTime);
            const end = timeToMins(b.endTime);
            while (cur < end) {
                blocked.add(`${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`);
                cur += 30;
            }
        });
    return blocked;
}

function bookingSlotClick(btn, slot) {
    if (btn.classList.contains("blocked")) return;
    const durationInput = document.getElementById("totalTimeDisplay");

    if (startSlot !== null) {
        if (slot === startSlot) {
            // Tap start again → deselect all
            selectedSlots.clear();
            document.querySelectorAll("#timeslotGrid .slot-btn").forEach(b => b.classList.remove("selected"));
            startSlot = null;
            durationInput.value = "00:00";
            durationInput.disabled = true;
        } else {
            const from = slot < startSlot ? slot : startSlot;
            const to   = slot > startSlot ? slot : startSlot;
            startSlot = null;
            selectBookingRange(from, to);
        }
    } else {
        // Start fresh selection
        selectedSlots.clear();
        document.querySelectorAll("#timeslotGrid .slot-btn").forEach(b => b.classList.remove("selected"));
        startSlot = slot;
        selectedSlots.add(slot);
        btn.classList.add("selected");
        durationInput.value = "";
        durationInput.disabled = false;
        durationInput.focus();
    }
    updateTotalTime();
    updatePrice();
}

function selectBookingRange(from, to) {
    selectedSlots.clear();
    document.querySelectorAll("#timeslotGrid .slot-btn").forEach(btn => btn.classList.remove("selected"));
    let cur = timeToMins(from);
    const endMins = timeToMins(to);
    while (cur <= endMins) {
        const s = `${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`;
        const btn = document.querySelector(`#timeslotGrid .slot-btn[data-slot="${s}"]`);
        if (!btn || btn.classList.contains("blocked")) break;
        selectedSlots.add(s);
        btn.classList.add("selected");
        cur += 30;
    }
    document.getElementById("totalTimeDisplay").disabled = false;
    updateTotalTime();
    updatePrice();
}

function parseDurationMins(value) {
    if (!value || !value.trim()) return null;
    value = value.trim();
    let total = 0;
    if (value.includes(":")) {
        const [h, m] = value.split(":").map(s => parseInt(s, 10) || 0);
        total = h * 60 + m;
    } else {
        total = (parseFloat(value) || 0) * 60;
    }
    if (total <= 0) return null;
    return Math.ceil(total / 30) * 30;
}

function applyDuration(value) {
    const mins = parseDurationMins(value);
    if (!mins) return;
    let base = startSlot;
    if (!base) {
        const sorted = Array.from(selectedSlots).sort();
        if (sorted.length === 0) return;
        base = sorted[0];
    }
    // Last slot to INCLUDE = base + mins - 30 (inclusive range, endTime = last + 30)
    const lastMins = Math.min(timeToMins(base) + mins - 30, (END_HOUR - 1) * 60 + 30);
    const lastSlot = `${pad(Math.floor(lastMins / 60))}:${pad(lastMins % 60)}`;
    startSlot = null;
    selectBookingRange(base, lastSlot);
}

function updateTotalTime() {
    const mins = selectedSlots.size * 30;
    document.getElementById("totalTimeDisplay").value =
        mins > 0 ? `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` : "00:00";
}

function updatePrice() {
    const weight = parseFloat(document.getElementById("weightInput").value) || 0;
    const filamentName = document.getElementById("filamentType").value;
    const fil = filaments.find(f => f.name === filamentName);
    document.getElementById("priceDisplay").textContent =
        `$${((weight / 1000) * (fil?.pricePerKg ?? 0)).toFixed(2)}`;
}

function updateEditPrice() {
    const weight = parseFloat(document.getElementById("editWeightInput").value) || 0;
    const filamentName = document.getElementById("editFilamentType").value;
    const fil = filaments.find(f => f.name === filamentName);
    document.getElementById("editPriceDisplay").textContent =
        `$${((weight / 1000) * (fil?.pricePerKg ?? 0)).toFixed(2)}`;
}

// ── AUTOCOMPLETE ──
function setupAutocomplete() {
    const input = document.getElementById("studentNameInput");
    const list = document.getElementById("autocompleteList");
    let activeIdx = -1;
    let debounceTimer = null;

    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSuggestions(input, list, activeIdx), 200);
    });

    input.addEventListener("keydown", e => {
        const items = list.querySelectorAll(".autocomplete-item");
        if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); updateActive(items, activeIdx); }
        else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, -1); updateActive(items, activeIdx); }
        else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); items[activeIdx]?.click(); }
        else if (e.key === "Escape") hideList(list);
    });

    document.addEventListener("click", e => {
        if (!e.target.closest(".autocomplete-wrap")) hideList(list);
    });

    function updateActive(items, idx) {
        items.forEach((it, i) => it.classList.toggle("active", i === idx));
    }

    async function fetchSuggestions(input, list, activeIdx) {
        const query = input.value;
        if (query.length < 3) { hideList(list); return; }
        try {
            const resp = await fetch(`/Index?handler=StudentNames&query=${encodeURIComponent(query)}`);
            const names = await resp.json();
            list.innerHTML = "";
            activeIdx = -1;
            if (names.length === 0) { hideList(list); return; }
            names.forEach(name => {
                const item = document.createElement("div");
                item.className = "autocomplete-item";
                const lower = query.toLowerCase();
                const idx = name.toLowerCase().indexOf(lower);
                if (idx >= 0) {
                    item.innerHTML = escHtml(name.slice(0, idx))
                        + `<strong>${escHtml(name.slice(idx, idx + query.length))}</strong>`
                        + escHtml(name.slice(idx + query.length));
                } else { item.textContent = name; }
                item.addEventListener("click", () => { input.value = name; hideList(list); });
                list.appendChild(item);
            });
            list.classList.remove("hidden");
        } catch { hideList(list); }
    }
}

function hideList(list) { list.classList.add("hidden"); }

let bottomMsgTimer = null;
function showBottomMsg(text) {
    const el = document.getElementById("bottomBarMsg");
    el.textContent = text;
    el.classList.add("visible");
    clearTimeout(bottomMsgTimer);
    bottomMsgTimer = setTimeout(() => el.classList.remove("visible"), 4000);
}

// Shows the weight-derived booking code so a student on a disconnected slicing
// PC can type it into the Slicer Booking Helper to dismiss it. Auto-closes after
// ~60s; the student can also close it manually once they've copied the code.
let bookingCodeTimer = null;
function showBookingCodeToast(code) {
    let toast = document.getElementById("bookingCodeToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "bookingCodeToast";
        toast.className = "booking-code-toast";
        toast.innerHTML =
            '<button type="button" class="booking-code-toast__close" aria-label="Close">&times;</button>' +
            '<div class="booking-code-toast__label">Booking code</div>' +
            '<div class="booking-code-toast__code"></div>' +
            '<div class="booking-code-toast__hint">Enter this in the Slicer Booking Helper to confirm your print.</div>';
        document.body.appendChild(toast);
        toast.querySelector(".booking-code-toast__close")
             .addEventListener("click", () => hideBookingCodeToast());
    }
    toast.querySelector(".booking-code-toast__code").textContent = code;
    toast.classList.add("visible");
    clearTimeout(bookingCodeTimer);
    bookingCodeTimer = setTimeout(hideBookingCodeToast, 60000);
}

function hideBookingCodeToast() {
    const toast = document.getElementById("bookingCodeToast");
    if (toast) toast.classList.remove("visible");
    clearTimeout(bookingCodeTimer);
}

function updateCreateBtn() {
    const btn = document.getElementById("openModalBtn");
    const isPast = currentDate < todayStr();
    // In kiosk mode keep the button clickable so the "sign in" message can appear
    const notLoggedIn = !currentUser.loggedIn && !currentUser.isKiosk && !currentUser.isSharedMode;
    const disabled = isPast || notLoggedIn;
    btn.disabled = disabled;
    btn.classList.toggle("create-btn--disabled", disabled);
}

// ── BOOKING MODAL ──
function openBookingModal() {
    editingBookingId = null;
    const today = todayStr();
    document.getElementById("bookingDate").value = currentDate >= today ? currentDate : today;
    document.getElementById("errorMsg").textContent = "";
    // Default to an editable weight; openPrefillBooking re-locks it when needed.
    const weightEl = document.getElementById("weightInput");
    weightEl.readOnly = false;
    weightEl.title = "";
    const nameInput = document.getElementById("studentNameInput");
    if (currentUser.isSharedMode) {
        nameInput.value = "";
        nameInput.disabled = false;
    } else {
        nameInput.value = currentUser.fullName || "";
        nameInput.disabled = true;
    }
    refreshTimeslots();
    document.getElementById("bookingModalOverlay").classList.add("open") || document.body.classList.remove("shift-on");
}

function closeBookingModal() {
    document.getElementById("bookingModalOverlay").classList.remove("open");
    startSlot = null;
    selectedSlots.clear();
    document.querySelectorAll("#timeslotGrid .slot-btn").forEach(b => b.classList.remove("selected"));
    document.getElementById("studentNameInput").value = "";
    document.getElementById("printerSelect").value = "";
    document.getElementById("studentClass").value = "";
    document.getElementById("weightInput").value = "";
    const durationInput = document.getElementById("totalTimeDisplay");
    durationInput.value = "00:00";
    durationInput.disabled = true;
    updatePrice();
}

// Set when a slicer prefill arrives while the user still has to sign in;
// resumePendingPrefill() picks it up after a successful login.
let pendingPrefill = null;

// Opened from the Slicer Booking Helper, which appends ?prefill=1&grams=..&filament=..&minutes=..
function applyPrefillFromUrl() {
    const params = new URLSearchParams(location.search);
    if (params.get("prefill") !== "1") return;

    // Strip the params so a refresh doesn't reopen the modal.
    history.replaceState(null, "", location.pathname);

    const prefill = {
        grams: params.get("grams"),
        filament: params.get("filament"),
        minutes: params.get("minutes"),
    };

    // In an individual login mode the login wall is already showing — hold the
    // prefill and reopen it automatically once they sign in.
    const notLoggedIn = !currentUser.loggedIn && !currentUser.isKiosk && !currentUser.isSharedMode;
    if (notLoggedIn) {
        pendingPrefill = prefill;
        showBottomMsg("Sign in to finish booking your sliced print.");
        return;
    }

    openPrefillBooking(prefill);
}

// Resume a prefill that was waiting on the user to log in.
async function resumePendingPrefill() {
    if (!pendingPrefill) return;
    const prefill = pendingPrefill;
    pendingPrefill = null;
    // Lists may have come back empty while signed out — refresh before filling.
    await Promise.all([loadFilaments(), loadClasses(), loadPrinters()]);
    openPrefillBooking(prefill);
}

function openPrefillBooking(prefill) {
    const missing = [];
    if (filaments.length === 0) missing.push("filaments");
    if (classes.length === 0) missing.push("classes");
    if (missing.length > 0) {
        showBottomMsg(currentUser.isAdmin
            ? `Please add ${missing.join(" and ")} in Settings before booking.`
            : `Please ask an admin to add ${missing.join(" and ")} before booking.`);
        return;
    }

    openBookingModal();

    // Lock the weight to the sliced value so it can't be edited down.
    const weightEl = document.getElementById("weightInput");
    if (prefill.grams) {
        weightEl.value = prefill.grams;
        weightEl.readOnly = true;
        weightEl.title = "Weight is taken from your sliced file and can't be changed.";
    }

    const filament = (prefill.filament || "").trim().toLowerCase();
    if (filament) {
        const sel = document.getElementById("filamentType");
        const match = Array.from(sel.options).find(o => {
            const v = o.value.toLowerCase();
            return v === filament || v.includes(filament) || filament.includes(v);
        });
        if (match) sel.value = match.value;
    }

    updatePrice();

    const minutes = parseInt(prefill.minutes, 10);
    if (minutes > 0) {
        const h = Math.floor(minutes / 60), m = minutes % 60;
        const t = h > 0 ? `${h}h ${m}m` : `${m}m`;
        showBottomMsg(`Slicer estimate: ${t}. Pick a printer, then select about that much time on the grid.`);
    }
}

async function submitBooking() {
    const err = document.getElementById("errorMsg");
    if (isOffline) { err.textContent = "Cannot create bookings while offline."; return; }
    const name = document.getElementById("studentNameInput").value.trim();
    const printer = document.getElementById("printerSelect").value;
    const date = document.getElementById("bookingDate").value;
    const cls = document.getElementById("studentClass").value;
    const weight = parseFloat(document.getElementById("weightInput").value) || 0;
    const filament = document.getElementById("filamentType").value;

    if (!name) { err.textContent = "Please enter a name."; return; }
    if (!printer) { err.textContent = "Please select a printer."; return; }
    if (!date) { err.textContent = "Please select a date."; return; }
    if (!cls) { err.textContent = "Please select a class."; return; }
    if (selectedSlots.size === 0) { err.textContent = "Please select at least one time slot."; return; }
    if (weight <= 0) { err.textContent = "Please enter the print weight in grams."; return; }
    err.textContent = "";

    const sorted = Array.from(selectedSlots).sort();
    const startTime = sorted[0];
    const lastMins = timeToMins(sorted[sorted.length - 1]) + 30;
    const endTime = `${pad(Math.floor(lastMins / 60))}:${pad(lastMins % 60)}`;

    const booking = {
        studentName: name, studentClass: cls, printerName: printer,
        date, startTime, endTime, filamentType: filament,
        weightGrams: weight, bookingType: "booking"
    };

    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch("/Index?handler=CreateBooking", {
            method: "POST",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
            body: JSON.stringify(booking)
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const saved = await resp.json();
        bookings.push(saved);
        closeBookingModal();
        renderGrid();
        if (saved.bookingCode) showBookingCodeToast(saved.bookingCode);
    } catch {
        err.textContent = "Failed to save booking. Please try again.";
    }
}

// ── EDIT MODAL ──
function openEditModal(id) {
    const b = bookings.find(x => x.id === id) ?? allBookingsCache.find(x => x.id === id);
    if (!b) return;
    if (!currentUser.loggedIn) return;
    if (!currentUser.isAdmin && !currentUser.isSharedMode && b.date < todayStr()) return;
    if (!currentUser.isAdmin && !currentUser.isSharedMode && b.studentName !== currentUser.fullName) return;
    editingBookingId = id;

    const nameInput = document.getElementById("editStudentNameInput");
    nameInput.disabled = !currentUser.isAdmin && !currentUser.isSharedMode;

    // Populate fields
    nameInput.value = b.studentName;
    document.getElementById("editPrinterSelect").value = b.printerName;
    document.getElementById("editBookingDate").value = b.date;
    document.getElementById("editStudentClass").value = b.studentClass;
    document.getElementById("editWeightInput").value = b.weightGrams;
    document.getElementById("editFilamentType").value = b.filamentType;
    document.getElementById("editErrorMsg").textContent = "";
    updateEditPrice();

    // Build timeslot grid for edit modal, blocked = other bookings on same printer/date (excluding this one)
    buildEditTimeslotGrid(b);

    document.getElementById("editModalOverlay").classList.add("open") || document.body.classList.remove("shift-on");
}

function buildEditTimeslotGrid(b) {
    const grid = document.getElementById("editTimeslotGrid");
    grid.innerHTML = "";
    const taken = getBlockedSlots(b.printerName, b.date, b.id);
    editStartSlot = null;

    const currentSlots = new Set();
    let cur = timeToMins(b.startTime);
    while (cur < timeToMins(b.endTime)) {
        currentSlots.add(`${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`);
        cur += 30;
    }

    for (let h = START_HOUR; h < END_HOUR; h++) {
        for (const m of [0, 30]) {
            const s = `${pad(h)}:${pad(m)}`;
            const btn = document.createElement("button");
            btn.className = "slot-btn";
            btn.textContent = formatTime12(s);
            btn.dataset.slot = s;
            if (taken.has(s)) {
                btn.classList.add("blocked");
            } else if (currentSlots.has(s)) {
                btn.classList.add("selected");
            }
            btn.addEventListener("click", () => editSlotClick(btn, s));
            grid.appendChild(btn);
        }
    }
    editStartSlot = null;
    updateEditTotalTime();
    document.getElementById("editTotalTimeDisplay").disabled = false;
}

function editSlotClick(btn, slot) {
    if (btn.classList.contains("blocked")) return;
    const durationInput = document.getElementById("editTotalTimeDisplay");

    if (editStartSlot !== null) {
        if (slot === editStartSlot) {
            document.querySelectorAll("#editTimeslotGrid .slot-btn").forEach(b => b.classList.remove("selected"));
            editStartSlot = null;
            durationInput.value = "00:00";
        } else {
            const from = slot < editStartSlot ? slot : editStartSlot;
            const to   = slot > editStartSlot ? slot : editStartSlot;
            editStartSlot = null;
            selectEditRange(from, to);
        }
    } else {
        document.querySelectorAll("#editTimeslotGrid .slot-btn").forEach(b => b.classList.remove("selected"));
        editStartSlot = slot;
        btn.classList.add("selected");
        durationInput.value = "";
        durationInput.focus();
    }
    updateEditTotalTime();
    updateEditPrice();
}

function selectEditRange(from, to) {
    document.querySelectorAll("#editTimeslotGrid .slot-btn").forEach(btn => btn.classList.remove("selected"));
    let cur = timeToMins(from);
    const endMins = timeToMins(to);
    while (cur <= endMins) {
        const s = `${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`;
        const btn = document.querySelector(`#editTimeslotGrid .slot-btn[data-slot="${s}"]`);
        if (!btn || btn.classList.contains("blocked")) break;
        btn.classList.add("selected");
        cur += 30;
    }
    updateEditTotalTime();
    updateEditPrice();
}

function applyEditDuration(value) {
    const mins = parseDurationMins(value);
    if (!mins) return;
    let base = editStartSlot;
    if (!base) {
        const selected = Array.from(document.querySelectorAll("#editTimeslotGrid .slot-btn.selected")).map(b => b.dataset.slot).sort();
        if (selected.length === 0) return;
        base = selected[0];
    }
    const lastMins = Math.min(timeToMins(base) + mins - 30, (END_HOUR - 1) * 60 + 30);
    const lastSlot = `${pad(Math.floor(lastMins / 60))}:${pad(lastMins % 60)}`;
    editStartSlot = null;
    selectEditRange(base, lastSlot);
}

function updateEditTotalTime() {
    const count = document.querySelectorAll("#editTimeslotGrid .slot-btn.selected").length;
    const mins = count * 30;
    document.getElementById("editTotalTimeDisplay").value =
        mins > 0 ? `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` : "00:00";
}

function closeEditModal() {
    document.getElementById("editModalOverlay").classList.remove("open");
    editingBookingId = null;
    editStartSlot = null;
}

async function saveEdit() {
    const err = document.getElementById("editErrorMsg");
    if (isOffline) { err.textContent = "Cannot save changes while offline."; return; }
    const name = document.getElementById("editStudentNameInput").value.trim();
    const printer = document.getElementById("editPrinterSelect").value;
    const date = document.getElementById("editBookingDate").value;
    const cls = document.getElementById("editStudentClass").value;
    const weight = parseFloat(document.getElementById("editWeightInput").value) || 0;
    const filament = document.getElementById("editFilamentType").value;

    const selectedBtns = Array.from(document.querySelectorAll("#editTimeslotGrid .slot-btn.selected"));
    const slots = selectedBtns.map(b => b.dataset.slot).sort();

    if (!name) { err.textContent = "Please enter a name."; return; }
    if (!printer) { err.textContent = "Please select a printer."; return; }
    if (!cls) { err.textContent = "Please select a class."; return; }
    if (slots.length === 0) { err.textContent = "Please select at least one time slot."; return; }
    if (weight <= 0) { err.textContent = "Please enter the print weight in grams."; return; }
    err.textContent = "";

    const lastMins = timeToMins(slots[slots.length - 1]) + 30;
    const endTime = `${pad(Math.floor(lastMins / 60))}:${pad(lastMins % 60)}`;

    const updated = {
        id: editingBookingId,
        studentName: name, studentClass: cls, printerName: printer,
        date, startTime: slots[0], endTime,
        filamentType: filament, weightGrams: weight, bookingType: "booking"
    };

    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch("/Index?handler=UpdateBooking", {
            method: "POST",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
            body: JSON.stringify(updated)
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const saved = await resp.json();
        // Replace in local array
        const idx = bookings.findIndex(b => b.id === editingBookingId);
        if (idx >= 0) bookings[idx] = saved;
        closeEditModal();
        renderGrid();
    } catch {
        err.textContent = "Failed to save changes. Please try again.";
    }
}

async function deleteBooking() {
    if (!editingBookingId) return;
    if (isOffline) { showBottomMsg("Cannot delete bookings while offline."); return; }
    if (!confirm("Are you sure you want to delete this booking?")) return;

    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch(`/Index?handler=DeleteBooking&id=${editingBookingId}`, {
            method: "POST",
            headers: { "RequestVerificationToken": token }
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        bookings = bookings.filter(b => b.id !== editingBookingId);
        closeEditModal();
        renderGrid();
    } catch {
        document.getElementById("editErrorMsg").textContent = "Failed to delete booking.";
    }
}

// ── SETTINGS MODAL ──
async function openSettings() {
    settingsFilaments = filaments.map(f => ({ ...f }));
    settingsClasses = classes.map(c => ({ ...c }));
    settingsPrinters = printers.map(p => ({ ...p }));
    selectedFilamentIdx = -1;
    selectedClassIdx = -1;
    selectedPrinterIdx = -1;
    selectedAdminIdx = -1;
    // Load admin list from server
    try {
        const adminsResp = await fetch("/Index?handler=Admins");
        settingsAdmins = adminsResp.ok ? await adminsResp.json() : [];
    } catch { settingsAdmins = []; }
    // Update kiosk status display
    const kioskStatusEl = document.getElementById("kioskStatusText");
    if (kioskStatusEl) {
        kioskStatusEl.textContent = currentUser.isKiosk ? "Kiosk mode is ON" : "Kiosk mode is OFF";
        kioskStatusEl.style.color = currentUser.isKiosk ? "var(--blue-dark)" : "var(--muted)";
    }
    document.getElementById("pinNewInput").value = "";
    document.getElementById("pinSettingsErrorMsg").textContent = "";
    switchTab("filaments");
    renderFilamentList();
    renderClassList();
    renderPrinterList();
    renderAdminList();
    document.getElementById("settingsModalOverlay").classList.add("open") || document.body.classList.remove("shift-on");
}

function closeSettings() {
    document.getElementById("settingsModalOverlay").classList.remove("open");
    document.getElementById("settingsSaveError").textContent = "";
    document.getElementById("adminErrorMsg").textContent = "";
    clearFilamentInputs();
    clearClassInputs();
    clearPrinterInputs();
}

function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach(p =>
        p.classList.toggle("active", p.dataset.tab === tab));
}

// ── FILAMENT SETTINGS ──
function renderFilamentList() {
    const box = document.getElementById("filamentListBox");
    box.innerHTML = "";
    settingsFilaments.forEach((f, i) => {
        const row = makeEl("div", "settings-list-item printer-list-item");
        row.classList.toggle("selected", i === selectedFilamentIdx);
        row.setAttribute("draggable", "true");
        row.innerHTML = `<span class="drag-handle">⠿</span><span class="item-name">${escHtml(f.name)}</span><span class="item-price">$${(+f.pricePerKg).toFixed(2)}/kg</span>`;
        row.addEventListener("click", () => {
            selectedFilamentIdx = i;
            renderFilamentList();
            document.getElementById("filamentNameInput").value = f.name;
            document.getElementById("filamentPriceInput").value = f.pricePerKg;
        });
        row.addEventListener("dragstart", e => {
            dragSrcIdx = i;
            e.dataTransfer.effectAllowed = "move";
            setTimeout(() => row.classList.add("dragging"), 0);
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging");
            box.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        });
        row.addEventListener("dragover", e => {
            e.preventDefault();
            box.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
            if (dragSrcIdx !== null && dragSrcIdx !== i) row.classList.add("drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", e => {
            e.preventDefault();
            row.classList.remove("drag-over");
            if (dragSrcIdx === null || dragSrcIdx === i) return;
            const [moved] = settingsFilaments.splice(dragSrcIdx, 1);
            settingsFilaments.splice(i, 0, moved);
            selectedFilamentIdx = i;
            dragSrcIdx = null;
            renderFilamentList();
        });
        box.appendChild(row);
    });
}

function addFilament() {
    const name = document.getElementById("filamentNameInput").value.trim();
    const price = parseFloat(document.getElementById("filamentPriceInput").value) || 0;
    if (!name) return;
    const existing = settingsFilaments.findIndex(f => f.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) { settingsFilaments[existing].pricePerKg = price; }
    else { settingsFilaments.push({ id: 0, name, pricePerKg: price }); }
    clearFilamentInputs();
    selectedFilamentIdx = -1;
    renderFilamentList();
}

function editFilament() {
    if (selectedFilamentIdx < 0) return;
    const name = document.getElementById("filamentNameInput").value.trim();
    const price = parseFloat(document.getElementById("filamentPriceInput").value) || 0;
    if (!name) return;
    settingsFilaments[selectedFilamentIdx] = { ...settingsFilaments[selectedFilamentIdx], name, pricePerKg: price };
    clearFilamentInputs();
    selectedFilamentIdx = -1;
    renderFilamentList();
}

function removeFilament() {
    if (selectedFilamentIdx < 0) return;
    settingsFilaments.splice(selectedFilamentIdx, 1);
    selectedFilamentIdx = -1;
    clearFilamentInputs();
    renderFilamentList();
}

function clearFilamentInputs() {
    document.getElementById("filamentNameInput").value = "";
    document.getElementById("filamentPriceInput").value = "";
}

// ── CLASS SETTINGS ──
function renderClassList() {
    const box = document.getElementById("classListBox");
    box.innerHTML = "";
    settingsClasses.forEach((c, i) => {
        const row = makeEl("div", "settings-list-item printer-list-item");
        row.classList.toggle("selected", i === selectedClassIdx);
        row.setAttribute("draggable", "true");
        row.innerHTML = `<span class="drag-handle">⠿</span><span class="item-name">${escHtml(c.name)}</span>`;
        row.addEventListener("click", () => {
            selectedClassIdx = i;
            renderClassList();
            document.getElementById("classNameInput").value = c.name;
        });
        row.addEventListener("dragstart", e => {
            dragSrcIdx = i;
            e.dataTransfer.effectAllowed = "move";
            setTimeout(() => row.classList.add("dragging"), 0);
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging");
            box.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        });
        row.addEventListener("dragover", e => {
            e.preventDefault();
            box.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
            if (dragSrcIdx !== null && dragSrcIdx !== i) row.classList.add("drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", e => {
            e.preventDefault();
            row.classList.remove("drag-over");
            if (dragSrcIdx === null || dragSrcIdx === i) return;
            const [moved] = settingsClasses.splice(dragSrcIdx, 1);
            settingsClasses.splice(i, 0, moved);
            selectedClassIdx = i;
            dragSrcIdx = null;
            renderClassList();
        });
        box.appendChild(row);
    });
}

function addClass() {
    const name = document.getElementById("classNameInput").value.trim();
    if (!name) return;
    if (!settingsClasses.find(c => c.name.toLowerCase() === name.toLowerCase())) {
        settingsClasses.push({ id: 0, name });
    }
    clearClassInputs();
    selectedClassIdx = -1;
    renderClassList();
}

function removeClass() {
    if (selectedClassIdx < 0) return;
    settingsClasses.splice(selectedClassIdx, 1);
    selectedClassIdx = -1;
    clearClassInputs();
    renderClassList();
}

function clearClassInputs() {
    document.getElementById("classNameInput").value = "";
}

// ── SAVE SETTINGS ──
async function saveSettings() {
    const errEl = document.getElementById("settingsSaveError");
    errEl.textContent = "";
    if (isOffline) { errEl.textContent = "Cannot save settings while offline."; return; }
    const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;

    try {
        const post = (handler, body) => fetch(`/Index?handler=${handler}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
            body: JSON.stringify(body)
        });

        const filRes     = await post("SaveFilaments", settingsFilaments.map((f, i) => ({ ...f, sortOrder: i })));
        const clsRes     = await post("SaveClasses",   settingsClasses.map((c, i)   => ({ ...c, sortOrder: i })));
        const printerRes = await post("SavePrinters",  settingsPrinters.map((p, i)  => ({ ...p, sortOrder: i })));
        const adminRes   = await post("SaveAdmins",    settingsAdmins);

        if (!filRes.ok || !clsRes.ok || !printerRes.ok || !adminRes.ok) {
            errEl.textContent = "Save failed. Please try again.";
            return;
        }

        await Promise.all([loadFilaments(), loadClasses(), loadPrinters()]);
        renderGrid();
        closeSettings();
    } catch {
        errEl.textContent = "Save failed. Please try again.";
    }
}

// ── STATISTICS MODAL ──
function openStatsModal() {
    // Populate class dropdown
    const sel = document.getElementById("statsClass");
    sel.innerHTML = '<option value="">All Classes</option>';
    classes.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = c.name;
        sel.appendChild(opt);
    });

    // Default date range: 6 months ago → today (AEST)
    const to = todayStr();
    const fromDate = new Date(Date.now() + 10 * 60 * 60 * 1000);
    fromDate.setUTCMonth(fromDate.getUTCMonth() - 6);
    const from = fromDate.toISOString().slice(0, 10);
    document.getElementById("statsFrom").value = from;
    document.getElementById("statsTo").value = to;

    document.getElementById("statsModalOverlay").classList.add("open") || document.body.classList.remove("shift-on");
    fetchStats();
}

function closeStatsModal() {
    document.getElementById("statsModalOverlay").classList.remove("open");
}

async function fetchStats() {
    const className = document.getElementById("statsClass").value;
    const from = document.getElementById("statsFrom").value;
    const to = document.getElementById("statsTo").value;

    const params = new URLSearchParams({ handler: "Stats" });
    if (className) params.set("className", className);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    document.getElementById("statsBody").innerHTML = '<p style="padding:20px;color:var(--muted)">Loading…</p>';
    try {
        const resp = await fetch(`/Index?${params}`);
        const data = await resp.json();
        renderStatsTable(data);
    } catch {
        document.getElementById("statsBody").innerHTML = '<p style="padding:20px;color:#c0392b">Failed to load statistics.</p>';
    }
}

function renderStatsTable(data) {
    const body = document.getElementById("statsBody");

    if (data.length === 0) {
        body.innerHTML = '<p style="padding:20px;color:var(--muted)">No bookings found for this selection.</p>';
        return;
    }

    // Collect all filament types across all students (in order first seen)
    const filamentTypes = [];
    data.forEach(s => {
        Object.keys(s.filaments).forEach(f => {
            if (!filamentTypes.includes(f)) filamentTypes.push(f);
        });
    });

    // Build table
    const table = document.createElement("table");
    table.className = "stats-table";

    // Header
    const thead = table.createTHead();
    const hRow = thead.insertRow();
    const addTh = (text, bold) => {
        const th = document.createElement("th");
        th.textContent = text;
        if (bold) th.style.fontWeight = "700";
        hRow.appendChild(th);
    };
    addTh("Name");
    filamentTypes.forEach(f => { addTh(`${f} (g)`); addTh(`${f} ($)`); });
    addTh("Total (g)", true);
    addTh("Total ($)", true);

    // Rows
    const tbody = table.createTBody();
    let grandGrams = 0, grandCost = 0;
    const filamentGrandTotals = {};

    data.forEach(s => {
        const row = tbody.insertRow();
        const addTd = (text, bold, mono) => {
            const td = row.insertCell();
            td.textContent = text;
            if (bold) td.style.fontWeight = "700";
            if (mono) td.style.fontFamily = "'DM Mono', monospace";
            td.style.textAlign = mono ? "right" : "";
            return td;
        };
        addTd(s.studentName);
        filamentTypes.forEach(f => {
            const fd = s.filaments[f];
            const g = fd ? fd.grams : 0;
            const c = fd ? fd.cost : 0;
            addTd(g ? `${(+g).toFixed(2)}g` : "—", false, true);
            addTd(c ? `$${(+c).toFixed(2)}` : "—", false, true);
            filamentGrandTotals[f] = (filamentGrandTotals[f] || { grams: 0, cost: 0 });
            filamentGrandTotals[f].grams += g;
            filamentGrandTotals[f].cost += c;
        });
        addTd(`${(+s.totalGrams).toFixed(2)}g`, true, true);
        addTd(`$${(+s.totalCost).toFixed(2)}`, true, true);
        grandGrams += s.totalGrams;
        grandCost += s.totalCost;
    });

    // Totals row
    const tfoot = table.createTFoot();
    const tRow = tfoot.insertRow();
    tRow.className = "stats-total-row";
    const addTotTd = (text) => {
        const td = tRow.insertCell();
        td.textContent = text;
        td.style.fontFamily = "'DM Mono', monospace";
        td.style.textAlign = "right";
        return td;
    };
    const nameTd = tRow.insertCell();
    nameTd.textContent = "CLASS TOTAL";
    nameTd.style.fontWeight = "700";
    filamentTypes.forEach(f => {
        const ft = filamentGrandTotals[f] || { grams: 0, cost: 0 };
        addTotTd(`${ft.grams.toFixed(2)}g`);
        addTotTd(`$${ft.cost.toFixed(2)}`);
    });
    addTotTd(`${grandGrams.toFixed(2)}g`);
    addTotTd(`$${grandCost.toFixed(2)}`);

    body.innerHTML = "";
    body.appendChild(table);
}

// ── PRINTER SETTINGS ──
function renderPrinterList() {
    const box = document.getElementById("printerListBox");
    box.innerHTML = "";
    settingsPrinters.forEach((p, i) => {
        const row = makeEl("div", "settings-list-item printer-list-item");
        row.classList.toggle("selected", i === selectedPrinterIdx);
        row.setAttribute("draggable", "true");
        row.innerHTML = `<span class="drag-handle">⠿</span><span class="item-name">${escHtml(p.name)}</span>`;

        row.addEventListener("click", () => {
            selectedPrinterIdx = i;
            renderPrinterList();
            document.getElementById("printerNameInput").value = p.name;
        });

        row.addEventListener("dragstart", e => {
            dragSrcIdx = i;
            e.dataTransfer.effectAllowed = "move";
            setTimeout(() => row.classList.add("dragging"), 0);
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging");
            box.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        });
        row.addEventListener("dragover", e => {
            e.preventDefault();
            box.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
            if (dragSrcIdx !== null && dragSrcIdx !== i) row.classList.add("drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", e => {
            e.preventDefault();
            row.classList.remove("drag-over");
            if (dragSrcIdx === null || dragSrcIdx === i) return;
            const [moved] = settingsPrinters.splice(dragSrcIdx, 1);
            settingsPrinters.splice(i, 0, moved);
            selectedPrinterIdx = i;
            dragSrcIdx = null;
            renderPrinterList();
        });

        box.appendChild(row);
    });
}

function addPrinter() {
    const name = document.getElementById("printerNameInput").value.trim();
    if (!name) return;
    if (!settingsPrinters.find(p => p.name.toLowerCase() === name.toLowerCase())) {
        settingsPrinters.push({ id: 0, name, sortOrder: settingsPrinters.length });
    }
    clearPrinterInputs();
    selectedPrinterIdx = -1;
    renderPrinterList();
}

function editPrinter() {
    if (selectedPrinterIdx < 0) return;
    const name = document.getElementById("printerNameInput").value.trim();
    if (!name) return;
    settingsPrinters[selectedPrinterIdx] = { ...settingsPrinters[selectedPrinterIdx], name };
    clearPrinterInputs();
    selectedPrinterIdx = -1;
    renderPrinterList();
}

function removePrinter() {
    if (selectedPrinterIdx < 0) return;
    settingsPrinters.splice(selectedPrinterIdx, 1);
    selectedPrinterIdx = -1;
    clearPrinterInputs();
    renderPrinterList();
}

function clearPrinterInputs() {
    document.getElementById("printerNameInput").value = "";
}

// ── LIST MODAL ──
let allBookingsCache = [];

async function openListModal() {
    document.getElementById("listSearch").value = "";
    document.getElementById("listBody").innerHTML = '<p style="padding:20px;color:var(--muted)">Loading…</p>';
    document.getElementById("listModalOverlay").classList.add("open") || document.body.classList.remove("shift-on");
    try {
        const resp = await fetch("/Index?handler=AllBookings");
        allBookingsCache = await resp.json();
    } catch {
        allBookingsCache = [];
    }
    renderListModal(allBookingsCache);
}

function closeListModal() {
    document.getElementById("listModalOverlay").classList.remove("open");
}

function filterListModal(query) {
    const q = query.toLowerCase();
    const filtered = q
        ? allBookingsCache.filter(b =>
            b.studentName?.toLowerCase().includes(q) ||
            b.studentClass?.toLowerCase().includes(q) ||
            b.printerName?.toLowerCase().includes(q) ||
            b.filamentType?.toLowerCase().includes(q) ||
            b.date?.includes(q))
        : allBookingsCache;
    renderListModal(filtered);
}

function renderListModal(list) {
    const typeLabels = { maintenance: "Maintenance", outoforder: "Out of Order", unavailable: "Block Printing" };
    const body = document.getElementById("listBody");

    if (list.length === 0) {
        body.innerHTML = '<p style="padding:20px;color:var(--muted)">No bookings found.</p>';
        return;
    }

    body.innerHTML = "";
    list.forEach(b => {
        const isBlock = b.bookingType !== "booking";
        const [y, m, d] = b.date.split("-");
        const dateStr = `${d}/${m}/${y}`;
        const label = isBlock ? (typeLabels[b.bookingType] || b.bookingType) : escHtml(b.studentName);

        const row = document.createElement("div");
        row.className = "list-row" + (isBlock ? " list-row-block" : "");

        const info = document.createElement("span");
        info.className = "list-row-info";
        if (isBlock) {
            info.innerHTML = `<strong>${dateStr}</strong> | ${escHtml(b.printerName)} | <em>${label}</em>`;
        } else {
            info.innerHTML =
                `<strong>${dateStr}</strong> | ${escHtml(b.printerName)} | ${escHtml(b.studentName)} | ` +
                `${escHtml(b.studentClass)} | ${escHtml(b.filamentType)} | ` +
                `${(+b.weightGrams).toFixed(2)}g | $${(+b.price).toFixed(2)}`;
        }

        const editBtn = document.createElement("button");
        editBtn.className = "list-edit-btn";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => {
            closeListModal();
            if (isBlock) openEditBlockModal(b.id);
            else openEditModal(b.id);
        });

        row.appendChild(info);
        row.appendChild(editBtn);
        body.appendChild(row);
    });
}

// ── BLOCK MODAL ──
function openBlockModal() {
    editingBlockId = null;
    document.getElementById("blockDate").value = currentDate;
    document.getElementById("blockPrinterSelect").value = "";
    document.getElementById("blockReasonSelect").value = "";
    document.getElementById("blockErrorMsg").textContent = "";
    document.getElementById("blockDeleteBtn").style.display = "none";
    selectedBlockSlots.clear();
    buildBlockTimeslotGrid();
    document.getElementById("blockModalOverlay").classList.add("open") || document.body.classList.remove("shift-on");
}

function openEditBlockModal(id) {
    const b = bookings.find(x => x.id === id) ?? allBookingsCache.find(x => x.id === id);
    if (!b) return;
    editingBlockId = id;
    document.getElementById("blockPrinterSelect").value = b.printerName;
    document.getElementById("blockReasonSelect").value = b.bookingType;
    document.getElementById("blockDate").value = b.date;
    document.getElementById("blockErrorMsg").textContent = "";
    document.getElementById("blockDeleteBtn").style.display = "";
    selectedBlockSlots.clear();
    let cur = timeToMins(b.startTime);
    while (cur < timeToMins(b.endTime)) {
        selectedBlockSlots.add(`${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`);
        cur += 30;
    }
    buildBlockTimeslotGrid(b.printerName, b.date, b.id);
    document.getElementById("blockModalOverlay").classList.add("open") || document.body.classList.remove("shift-on");
}

function closeBlockModal() {
    document.getElementById("blockModalOverlay").classList.remove("open");
    selectedBlockSlots.clear();
    blockStartSlot = null;
    editingBlockId = null;
}

function buildBlockTimeslotGrid(printer, date, excludeId = null) {
    const grid = document.getElementById("blockTimeslotGrid");
    grid.innerHTML = "";
    document.getElementById("blockTimeslotOverlay").classList.toggle("hidden", !!printer);
    const taken = printer && date ? getBlockedSlots(printer, date, excludeId) : new Set();
    blockStartSlot = null;
    for (let h = START_HOUR; h < END_HOUR; h++) {
        for (const m of [0, 30]) {
            const s = `${pad(h)}:${pad(m)}`;
            const btn = document.createElement("button");
            btn.className = "slot-btn";
            btn.textContent = formatTime12(s);
            btn.dataset.slot = s;
            if (taken.has(s)) {
                btn.classList.add("blocked");
            } else if (selectedBlockSlots.has(s)) {
                btn.classList.add("selected");
            }
            btn.addEventListener("click", () => blockSlotClick(btn, s));
            grid.appendChild(btn);
        }
    }
}

function blockSlotClick(btn, slot) {
    if (btn.classList.contains("blocked")) return;

    if (blockStartSlot !== null) {
        if (slot === blockStartSlot) {
            selectedBlockSlots.clear();
            document.querySelectorAll("#blockTimeslotGrid .slot-btn").forEach(b => b.classList.remove("selected"));
            blockStartSlot = null;
        } else {
            const from = slot < blockStartSlot ? slot : blockStartSlot;
            const to   = slot > blockStartSlot ? slot : blockStartSlot;
            blockStartSlot = null;
            selectBlockRange(from, to);
        }
    } else {
        selectedBlockSlots.clear();
        document.querySelectorAll("#blockTimeslotGrid .slot-btn").forEach(b => b.classList.remove("selected"));
        blockStartSlot = slot;
        selectedBlockSlots.add(slot);
        btn.classList.add("selected");
    }
}

function selectBlockRange(from, to) {
    selectedBlockSlots.clear();
    document.querySelectorAll("#blockTimeslotGrid .slot-btn").forEach(btn => btn.classList.remove("selected"));
    let cur = timeToMins(from);
    const endMins = timeToMins(to);
    while (cur <= endMins) {
        const s = `${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`;
        const btn = document.querySelector(`#blockTimeslotGrid .slot-btn[data-slot="${s}"]`);
        if (!btn || btn.classList.contains("blocked")) break;
        selectedBlockSlots.add(s);
        btn.classList.add("selected");
        cur += 30;
    }
}

async function enableKiosk() {
    const errEl = document.getElementById("kioskErrorMsg");
    errEl.textContent = "";
    try {
        const resp = await fetch("/Index?handler=EnableKiosk");
        if (!resp.ok) { errEl.textContent = "Failed to enable kiosk mode."; return; }
        await loadCurrentUser();
        const kioskStatusEl = document.getElementById("kioskStatusText");
        if (kioskStatusEl) {
            kioskStatusEl.textContent = "Kiosk mode is ON";
            kioskStatusEl.style.color = "var(--blue-dark)";
        }
    } catch { errEl.textContent = "Failed to enable kiosk mode."; }
}

async function disableKiosk() {
    const errEl = document.getElementById("kioskErrorMsg");
    errEl.textContent = "";
    try {
        const resp = await fetch("/Index?handler=ClearKiosk");
        if (!resp.ok) { errEl.textContent = "Failed to disable kiosk mode."; return; }
        await loadCurrentUser();
        const kioskStatusEl = document.getElementById("kioskStatusText");
        if (kioskStatusEl) {
            kioskStatusEl.textContent = "Kiosk mode is OFF";
            kioskStatusEl.style.color = "var(--muted)";
        }
    } catch { errEl.textContent = "Failed to disable kiosk mode."; }
}

function refreshBlockTimeslots() {
    const printer = document.getElementById("blockPrinterSelect").value;
    const date = document.getElementById("blockDate").value;
    selectedBlockSlots.clear();
    blockStartSlot = null;
    buildBlockTimeslotGrid(printer, date, editingBlockId);
}

async function submitBlock() {
    const err = document.getElementById("blockErrorMsg");
    if (isOffline) { err.textContent = "Cannot make changes while offline."; return; }
    const printer = document.getElementById("blockPrinterSelect").value;
    const reason = document.getElementById("blockReasonSelect").value;
    const date = document.getElementById("blockDate").value;

    if (!printer) { err.textContent = "Please select a printer."; return; }
    if (!reason) { err.textContent = "Please select a reason."; return; }
    if (!date) { err.textContent = "Please select a date."; return; }
    if (selectedBlockSlots.size === 0) { err.textContent = "Please select at least one time slot."; return; }
    err.textContent = "";

    const sorted = Array.from(selectedBlockSlots).sort();
    const lastMins = timeToMins(sorted[sorted.length - 1]) + 30;
    const endTime = `${pad(Math.floor(lastMins / 60))}:${pad(lastMins % 60)}`;

    const block = {
        studentName: "", studentClass: "", printerName: printer,
        date, startTime: sorted[0], endTime,
        filamentType: "", weightGrams: 0, bookingType: reason
    };

    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        if (editingBlockId) {
            block.id = editingBlockId;
            const resp = await fetch("/Index?handler=UpdateBooking", {
                method: "POST",
                headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
                body: JSON.stringify(block)
            });
            if (!resp.ok) throw new Error(`${resp.status}`);
            const saved = await resp.json();
            const idx = bookings.findIndex(b => b.id === editingBlockId);
            if (idx >= 0) bookings[idx] = saved;
        } else {
            const resp = await fetch("/Index?handler=CreateBooking", {
                method: "POST",
                headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
                body: JSON.stringify(block)
            });
            if (!resp.ok) throw new Error(`${resp.status}`);
            const saved = await resp.json();
            bookings.push(saved);
        }
        closeBlockModal();
        renderGrid();
    } catch {
        err.textContent = "Failed to save block. Please try again.";
    }
}

async function deleteBlock() {
    if (!editingBlockId) return;
    if (isOffline) { showBottomMsg("Cannot make changes while offline."); return; }
    if (!confirm("Are you sure you want to remove this block?")) return;
    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch(`/Index?handler=DeleteBooking&id=${editingBlockId}`, {
            method: "POST",
            headers: { "RequestVerificationToken": token }
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        bookings = bookings.filter(b => b.id !== editingBlockId);
        closeBlockModal();
        renderGrid();
    } catch {
        document.getElementById("blockErrorMsg").textContent = "Failed to delete block.";
    }
}

// ── AUTH ──
async function loadCurrentUser() {
    try {
        const resp = await fetch("/Index?handler=CurrentUser");
        currentUser = await resp.json();
    } catch { currentUser = { loggedIn: false, isKiosk: false }; }

    if (currentUser.needsSetup) {
        openSetupModal();
        return;
    }

    updateAuthUI();
    scheduleAutoLogout();
}

function scheduleAutoLogout() {
    clearTimeout(autoLogoutTimer);
    if (currentUser.isKiosk && currentUser.loggedIn && currentUser.kioskSecondsRemaining > 0) {
        autoLogoutTimer = setTimeout(() => logout(), currentUser.kioskSecondsRemaining * 1000);
    } else if (currentUser.isSharedMode && currentUser.isAdmin && currentUser.pinSecondsRemaining > 0) {
        autoLogoutTimer = setTimeout(() => loadCurrentUser(), currentUser.pinSecondsRemaining * 1000);
    }
}

// ── PIN MODAL ──
function openPinModal() {
    document.querySelectorAll(".pin-digit").forEach(d => { d.value = ""; });
    document.getElementById("pinErrorMsg").textContent = "";
    document.getElementById("pinModalOverlay").classList.add("open");
    setTimeout(() => document.querySelector(".pin-digit").focus(), 80);
}

function closePinModal() {
    document.getElementById("pinModalOverlay").classList.remove("open");
}

function setupPinDigits() {
    const digits = [...document.querySelectorAll(".pin-digit")];
    digits.forEach((d, i) => {
        d.addEventListener("input", () => {
            d.value = d.value.replace(/\D/g, "").slice(-1);
            if (d.value && i < digits.length - 1) digits[i + 1].focus();
            if (d.value && i === digits.length - 1) submitPin();
        });
        d.addEventListener("keydown", e => {
            if (e.key === "Backspace" && !d.value && i > 0) digits[i - 1].focus();
        });
    });
}

async function submitPin() {
    const digits = [...document.querySelectorAll(".pin-digit")].map(d => d.value);
    const err = document.getElementById("pinErrorMsg");
    if (digits.some(d => !d)) { err.textContent = "Please enter all 4 digits."; return; }
    const pin = digits.join("");

    if (isOffline) {
        const cached = localStorage.getItem("cachedPin") || "0000";
        if (pin !== cached) { err.textContent = "Incorrect PIN."; return; }
        closePinModal();
        currentUser = { ...currentUser, isAdmin: true, pinSecondsRemaining: 300 };
        scheduleAutoLogout();
        updateAuthUI();
        renderGrid();
        return;
    }

    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch("/Index?handler=VerifyPin", {
            method: "POST",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
            body: JSON.stringify({ pin })
        });
        const data = await resp.json();
        if (!data.success) { err.textContent = data.error || "Incorrect PIN."; return; }
        localStorage.setItem("cachedPin", pin); // cache for offline use
        closePinModal();
        await loadCurrentUser();
        renderGrid();
    } catch { err.textContent = "Error verifying PIN. Please try again."; }
}

async function exitPinAdmin() {
    await fetch("/Index?handler=ExitPinAdmin");
    await loadCurrentUser();
    renderGrid();
}

async function savePin() {
    const pin = document.getElementById("pinNewInput").value;
    const err = document.getElementById("pinSettingsErrorMsg");
    err.style.color = "";
    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch("/Index?handler=SavePin", {
            method: "POST",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
            body: JSON.stringify({ pin })
        });
        const data = await resp.json();
        if (!data.success) { err.textContent = data.error || "Failed to save PIN."; return; }
        localStorage.setItem("cachedPin", pin); // cache for offline use
        document.getElementById("pinNewInput").value = "";
        err.style.color = "var(--blue-dark)";
        err.textContent = "PIN saved successfully.";
        setTimeout(() => { err.textContent = ""; err.style.color = ""; }, 2500);
    } catch { err.textContent = "Error saving PIN."; }
}

function updateTopbarLayout() {
    const bar      = document.querySelector(".topbar");
    const menu     = document.getElementById("topbarMenu");
    const leftCol  = document.querySelector(".topbar-left");
    const hamburger = document.getElementById("hamburgerBtn");

    // Temporarily measure menu's natural inline width without affecting layout
    const savedStyle = menu.getAttribute("style") || "";
    menu.style.cssText =
        "display:flex;position:absolute;visibility:hidden;" +
        "flex-direction:row;align-items:center;gap:10px;white-space:nowrap";
    hamburger.style.display = "none";

    const menuW = menu.scrollWidth;
    const leftW = leftCol.offsetWidth;
    const barW  = bar.offsetWidth;

    // Restore
    menu.setAttribute("style", savedStyle);
    hamburger.style.display = "";

    // 52 = topbar padding (40) + left/right gap (12)
    const collapse = leftW + menuW + 52 > barW;
    bar.classList.toggle("topbar-hamburger", collapse);
    if (!collapse) menu.classList.remove("open");
}

function updateHourHeight() {
    const scroll = document.querySelector('.scheduler-scroll');
    if (!scroll || scroll.clientHeight === 0) return;
    const headerEl = document.querySelector('.col-header');
    const headerH = headerEl ? headerEl.offsetHeight : 40;
    const newH = Math.max(64, Math.floor((scroll.clientHeight - headerH) / (END_HOUR - START_HOUR)));
    if (newH === HOUR_H) return;
    HOUR_H = newH;
    document.documentElement.style.setProperty('--hour-h', `${HOUR_H}px`);
    renderGrid();
}

function updateAuthUI() {
    const isAdmin      = currentUser.isAdmin;
    const loggedIn     = currentUser.loggedIn;
    const isKiosk      = currentUser.isKiosk;
    const isSharedMode = !!currentUser.isSharedMode;
    const loginMode    = currentUser.loginMode || "";

    document.getElementById("statsBtn").style.display    = isAdmin ? "" : "none";
    document.getElementById("blockBtn").style.display    = isAdmin ? "" : "none";
    document.getElementById("settingsBtn").style.display = isAdmin ? "" : "none";
    // PIN button: visible in no-login (shared) mode only when not yet admin
    document.getElementById("pinBtn").style.display   = isSharedMode && !isAdmin ? "" : "none";
    // Sign In button: hidden in shared mode or when already logged in
    document.getElementById("loginBtn").style.display = !loggedIn && !isSharedMode ? "" : "none";

    // User info row: shown when individually logged in OR when PIN admin in shared mode
    const showUserRow = (loggedIn && !isSharedMode) || (isSharedMode && isAdmin);
    document.getElementById("userInfoRow").style.display     = showUserRow ? "" : "none";
    document.getElementById("exitPinAdminBtn").style.display = isSharedMode && isAdmin ? "" : "none";
    document.getElementById("logoutBtn").style.display       = isSharedMode ? "none" : "";

    if (isSharedMode && isAdmin)
        document.getElementById("userDisplayName").textContent = "Admin (PIN)";
    else if (loggedIn && !isSharedMode)
        document.getElementById("userDisplayName").textContent = currentUser.fullName;

    document.body.classList.toggle("is-admin",       isAdmin);
    document.body.classList.toggle("is-logged-in",   loggedIn);
    document.body.classList.toggle("is-kiosk",       isKiosk);
    document.body.classList.toggle("is-shared-mode", isSharedMode);

    document.getElementById("adminBadge").style.display = isAdmin ? "inline-flex" : "none";
    document.getElementById("pinTabBtn").style.display  = isSharedMode ? "" : "none";

    // Update admins tab notice based on login mode
    const adminsNotice = document.getElementById("adminsTabNotice");
    if (adminsNotice) {
        if (loginMode === "nologin") {
            adminsNotice.textContent = "Individual admin accounts are not used in No Login mode. Use the admin PIN to unlock admin features.";
        } else if (loginMode === "ad") {
            adminsNotice.textContent = "Users in the configured AD admin group(s) are automatically granted admin access. Additional accounts can be added below by username.";
        } else if (loginMode === "manual") {
            adminsNotice.textContent = "Users marked as admin in the users.csv file are automatically granted admin access. Additional accounts can be added below by username.";
        } else {
            adminsNotice.textContent = "Additional admin accounts can be added below by username.";
        }
    }

    // Kiosk tab: disable buttons when in no-login mode
    const enableKioskBtn  = document.getElementById("enableKioskBtn");
    const disableKioskBtn = document.getElementById("disableKioskBtn");
    const kioskNoLoginMsg = document.getElementById("kioskNoLoginMsg");
    if (enableKioskBtn && disableKioskBtn) {
        const kioskDisabled = loginMode === "nologin";
        enableKioskBtn.disabled  = kioskDisabled;
        disableKioskBtn.disabled = kioskDisabled;
        if (kioskNoLoginMsg) kioskNoLoginMsg.style.display = kioskDisabled ? "" : "none";
    }

    updateCreateBtn();
    updateNoPrintersWarning();
    updateTopbarLayout();

    // Require login wall only in individual mode when not signed in
    if (!loggedIn && !isKiosk && !isSharedMode) requireLoginWall();
}

function setLoginWallInert(inert) {
    [".topbar", ".scheduler-outer", ".bottom-bar"].forEach(sel => {
        const el = document.querySelector(sel);
        if (!el) return;
        if (inert) el.setAttribute("inert", ""); else el.removeAttribute("inert");
    });
}

function requireLoginWall() {
    const overlay = document.getElementById("loginModalOverlay");
    overlay.dataset.required = "1";
    document.getElementById("loginCloseBtn").style.display = "none";
    document.getElementById("loginCancelBtn").style.display = "none";
    document.getElementById("loginUsername").value = "";
    document.getElementById("loginPassword").value = "";
    document.getElementById("loginErrorMsg").textContent = "";
    document.body.classList.add("login-required");
    setLoginWallInert(true);
    overlay.classList.add("open");
    setTimeout(() => document.getElementById("loginUsername").focus(), 80);
}

function openLoginModal() {
    const overlay = document.getElementById("loginModalOverlay");
    delete overlay.dataset.required;
    document.getElementById("loginCloseBtn").style.display = "";
    document.getElementById("loginCancelBtn").style.display = "";
    document.getElementById("loginUsername").value = "";
    document.getElementById("loginPassword").value = "";
    document.getElementById("loginErrorMsg").textContent = "";
    overlay.classList.add("open") || document.body.classList.remove("shift-on");
    setTimeout(() => document.getElementById("loginUsername").focus(), 80);
}

function closeLoginModal() {
    const overlay = document.getElementById("loginModalOverlay");
    if (overlay.dataset.required && !currentUser.loggedIn) return;
    delete overlay.dataset.required;
    document.getElementById("loginCloseBtn").style.display = "";
    document.getElementById("loginCancelBtn").style.display = "";
    document.body.classList.remove("login-required");
    setLoginWallInert(false);
    overlay.classList.remove("open");
}

async function submitLogin() {
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const err = document.getElementById("loginErrorMsg");
    if (!username || !password) { err.textContent = "Please enter your username and password."; return; }

    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch("/Index?handler=Login", {
            method: "POST",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
            body: JSON.stringify({ username, password })
        });
        const data = await resp.json();
        if (!data.success) { err.textContent = data.error || "Login failed."; return; }
        currentUser = { loggedIn: true, username: data.username, fullName: data.fullName, isAdmin: data.isAdmin, isKiosk: currentUser.isKiosk, kioskSecondsRemaining: currentUser.isKiosk ? 300 : 0 };
        scheduleAutoLogout();
        // Reset login wall state before updateAuthUI
        const overlay = document.getElementById("loginModalOverlay");
        delete overlay.dataset.required;
        document.getElementById("loginCloseBtn").style.display = "";
        document.getElementById("loginCancelBtn").style.display = "";
        document.body.classList.remove("login-required");
        setLoginWallInert(false);
        updateAuthUI();
        renderGrid();
        overlay.classList.remove("open");
        resumePendingPrefill();
    } catch { err.textContent = "Login failed. Please try again."; }
}

async function logout() {
    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        await fetch("/Index?handler=Logout", {
            method: "POST",
            headers: { "RequestVerificationToken": token }
        });
    } catch { /* ignore */ }
    // Re-fetch to preserve isKiosk state from cookie
    await loadCurrentUser();
    renderGrid();
}

// ── ADMIN SETTINGS ──
function renderAdminList() {
    const box = document.getElementById("adminListBox");
    box.innerHTML = "";
    settingsAdmins.forEach((u, i) => {
        const row = document.createElement("div");
        row.className = "settings-list-item" + (i === selectedAdminIdx ? " selected" : "");
        row.textContent = u;
        row.addEventListener("click", () => {
            selectedAdminIdx = i;
            renderAdminList();
            document.getElementById("adminUsernameInput").value = u;
        });
        box.appendChild(row);
    });
}

function addAdmin() {
    const u = document.getElementById("adminUsernameInput").value.trim();
    if (!u) return;
    document.getElementById("adminErrorMsg").textContent = "";
    if (!settingsAdmins.includes(u)) settingsAdmins.push(u);
    document.getElementById("adminUsernameInput").value = "";
    selectedAdminIdx = -1;
    renderAdminList();
}

function removeAdmin() {
    if (selectedAdminIdx < 0) return;
    document.getElementById("adminErrorMsg").textContent = "";
    settingsAdmins.splice(selectedAdminIdx, 1);
    selectedAdminIdx = -1;
    document.getElementById("adminUsernameInput").value = "";
    renderAdminList();
}

// ── SETUP MODAL (first launch) ──
let setupSelectedMode = null;

function setupSetupModal() {
    document.querySelectorAll(".setup-mode-card").forEach(card => {
        card.addEventListener("click", () => {
            setupSelectedMode = card.dataset.mode;
            document.querySelectorAll(".setup-mode-card").forEach(c =>
                c.classList.toggle("active", c === card));
            document.getElementById("setupAdFields").style.display     = setupSelectedMode === "ad"      ? "" : "none";
            document.getElementById("setupNologinFields").style.display = setupSelectedMode === "nologin" ? "" : "none";
            document.getElementById("setupManualFields").style.display  = setupSelectedMode === "manual"  ? "" : "none";
            document.getElementById("setupErrorMsg").textContent = "";
        });
    });
    document.getElementById("setupSubmitBtn").addEventListener("click", submitSetup);
}

function openSetupModal() {
    document.getElementById("setupModalOverlay").classList.add("open");
    setLoginWallInert(true);
}

async function submitSetup() {
    const err = document.getElementById("setupErrorMsg");
    err.textContent = "";

    if (!setupSelectedMode) { err.textContent = "Please select a login mode."; return; }

    const body = { loginMode: setupSelectedMode };

    if (setupSelectedMode === "ad") {
        body.adDomain     = document.getElementById("setupAdDomain").value.trim();
        body.adAdminGroups = document.getElementById("setupAdGroups").value.trim();
        if (!body.adDomain) { err.textContent = "Please enter the AD domain."; return; }
    } else if (setupSelectedMode === "nologin") {
        body.adminPin = document.getElementById("setupAdminPin").value.trim();
        if (!body.adminPin || body.adminPin.length !== 4 || !/^\d{4}$/.test(body.adminPin)) {
            err.textContent = "Admin PIN must be exactly 4 digits."; return;
        }
    }

    try {
        const token = document.querySelector('#af input[name="__RequestVerificationToken"]').value;
        const resp = await fetch("/Index?handler=Setup", {
            method: "POST",
            headers: { "Content-Type": "application/json", "RequestVerificationToken": token },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!data.success) { err.textContent = data.error || "Setup failed."; return; }
        // Setup done — close overlay and fully reload auth state
        document.getElementById("setupModalOverlay").classList.remove("open");
        setLoginWallInert(false);
        await loadCurrentUser();
        renderGrid();
    } catch { err.textContent = "Setup failed. Please try again."; }
}

// ── LIVE UPDATES (SignalR) ──
(function () {
    const connection = new signalR.HubConnectionBuilder()
        .withUrl("/schedulerHub")
        .withAutomaticReconnect()
        .build();

    connection.on("bookingsChanged", () => loadBookings());

    connection.on("settingsChanged", async () => {
        await Promise.all([loadFilaments(), loadClasses(), loadPrinters()]);
        renderGrid();
    });

    async function start() {
        try { await connection.start(); }
        catch { setTimeout(start, 5000); }
    }
    start();
})();

// ── HELPERS ──
function timeToMins(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function pad(n) { return String(n).padStart(2, "0"); }
function formatTime12(t) {
    const [h, m] = t.split(":").map(Number);
    const ampm = h < 12 ? "am" : "pm";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${pad(m)}${ampm}`;
}
function makeEl(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function escHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}