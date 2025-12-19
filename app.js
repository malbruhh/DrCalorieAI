const API_URL = "http://localhost:8000/analyze"; 

// --- State Management ---
let targets = { 
    cals: 2000, 
    p: 100, 
    c: 250, 
    f: 66 
}; 
let current = { cals: 0, p: 0, c: 0, f: 0 };
let history = [];
let chartInstance = null; // Fuzzy Graph
let donutChartInstance = null; // Calorie Donut
let lastScore = 50; 
let lastDeleted = null;
let currentImageBase64 = null; 
let currentTheme = 'light';

const MAX_HISTORY_LENGTH = 100; // Safety limit to prevent high RAM/Storage usage

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Theme
    const savedTheme = localStorage.getItem('nutriscan_theme') || 'light';
    applyTheme(savedTheme);

    // 2. Load Session Data from LocalStorage
    loadSession();

    // 3. Initialize UI Components
    initDonutChart(); 
    updateDashboard(); 
    setupSliderListeners();
    
    document.getElementById('scanBtn')?.addEventListener('click', analyzeFood);

    document.getElementById('userInput')?.addEventListener('keypress', (e) => {
        if(e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); 
            analyzeFood(); 
        }
    });

    document.getElementById('imageInput')?.addEventListener('change', handleImageSelect);
});

// --- Persistence Logic ---

function saveSession() {
    try {
        const sessionData = {
            targets,
            history,
            current // Saving current allows the bars to stay filled on reload
        };
        localStorage.setItem('nutriscan_session', JSON.stringify(sessionData));
    } catch (e) {
        console.error("Failed to save session to localStorage:", e);
    }
}

function loadSession() {
    const savedData = localStorage.getItem('nutriscan_session');
    if (savedData) {
        try {
            const data = JSON.parse(savedData);
            targets = data.targets || targets;
            history = data.history || [];
            current = data.current || { cals: 0, p: 0, c: 0, f: 0 };
            
            renderHistory();
        } catch (e) {
            console.error("Error parsing session data:", e);
        }
    }
}

// --- Theme Logic ---
window.toggleTheme = function() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
};

function applyTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('nutriscan_theme', theme);
    const body = document.body;
    const themeBtn = document.getElementById('themeToggleBtn');
    const icon = themeBtn?.querySelector('i');

    if (theme === 'dark') {
        body.classList.add('theme-dark');
        if (icon) {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
    } else {
        body.classList.remove('theme-dark');
        if (icon) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        }
    }

    if (donutChartInstance) {
        donutChartInstance.options.plugins.legend.labels.color = theme === 'dark' ? '#94a3b8' : '#64748b';
        donutChartInstance.update();
    }
}

// --- Image Handling ---
function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        currentImageBase64 = e.target.result;
        const previewContainer = document.getElementById('imagePreviewContainer');
        const previewImg = document.getElementById('previewImg');
        previewImg.src = currentImageBase64;
        previewContainer.classList.remove('hidden');
        previewContainer.classList.add('flex');
    };
    reader.readAsDataURL(file);
}

window.clearImage = function() {
    currentImageBase64 = null;
    const input = document.getElementById('imageInput');
    if (input) input.value = ""; 
    const container = document.getElementById('imagePreviewContainer');
    container.classList.add('hidden');
    container.classList.remove('flex');
};

// --- Core API Analysis ---
async function analyzeFood() {
    const input = document.getElementById('userInput').value;
    const btn = document.getElementById('scanBtn');
    const status = document.getElementById('statusMsg');

    if (!input.trim() && !currentImageBase64) return;

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    status?.classList.remove('hidden');
    
    try {
        const payload = { text: input, image: currentImageBase64 };
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload) 
        });

        if (!response.ok) throw new Error("Server Error");

        const data = await response.json();
        const items = Array.isArray(data) ? data : [data];
        
        items.forEach(item => {
            history.unshift(item);
            
            // Apply History Limit (Prevent RAM bloat)
            if (history.length > MAX_HISTORY_LENGTH) {
                history.pop(); 
            }

            current.cals += item.calories || 0;
            current.p += item.protein || 0;
            current.c += item.carbs || 0;
            current.f += item.fats || 0;
            
            const fuzzyRes = calculateFuzzyHealth(item.calories, item.protein, item.fats, item.carbs);
            lastScore = fuzzyRes.score;
        });

        saveSession(); // Persist changes
        renderHistory();
        updateDashboard();
        updateChart(); 
        clearImage();
        document.getElementById('userInput').value = ''; 

    } catch (error) {
        console.error(error);
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `Analyze`;
        status?.classList.add('hidden');
    }
}

// --- UI Rendering ---
function renderHistory() {
    const list = document.getElementById('foodLog');
    const countEl = document.getElementById('itemCount');
    if (!list) return;
    
    list.innerHTML = '';
    countEl.innerText = `${history.length} items`;

    history.forEach((item, index) => {
        const fuzzy = calculateFuzzyHealth(item.calories, item.protein, item.fats, item.carbs);
        const li = document.createElement('li');
        li.className = "item-card p-4 rounded-2xl shadow-sm fade-in group relative hover:shadow-md transition-all";
        li.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <i class="fa-solid fa-plus text-green-500 text-xs"></i>
                        <span class="font-bold capitalize text-base">${item.food_name}</span>
                        <span class="badge-cal px-2 py-0.5 rounded text-[11px] font-mono font-bold ml-1">${item.calories} kcal</span>
                    </div>
                    <span class="text-[10px] uppercase font-bold tracking-wider ml-5 mt-1 block w-fit text-${fuzzy.colorName}-600 bg-${fuzzy.colorName}-100 px-2 py-0.5 rounded-md">${fuzzy.category}</span>
                </div>
                <button onclick="deleteItem(${index})" class="text-gray-300 hover:text-red-500 transition px-2">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
            <div class="flex gap-2 text-xs pl-5 overflow-x-auto no-scrollbar">
                <span class="badge-p px-2 py-1 rounded-lg font-mono font-medium">${item.protein}g P</span>
                <span class="badge-c px-2 py-1 rounded-lg font-mono font-medium">${item.carbs}g C</span>
                <span class="badge-f px-2 py-1 rounded-lg font-mono font-medium">${item.fats}g F</span>
            </div>
        `;
        list.appendChild(li);
    });
}

window.deleteItem = function(index) {
    const item = history[index];
    current.cals -= item.calories;
    current.p -= item.protein;
    current.c -= item.carbs;
    current.f -= item.fats;
    history.splice(index, 1);
    
    saveSession(); // Persist deletion
    renderHistory();
    updateDashboard();
};

function initDonutChart() {
    const canvas = document.getElementById('calorieDonut');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    donutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Protein', 'Carbs', 'Fat', 'Remaining'],
            datasets: [{
                data: [0, 0, 0, targets.cals],
                backgroundColor: ['#EF4444', '#3B82F6', '#EAB308', '#F3F4F6'],
                borderWidth: 0,
                hoverOffset: 4,
                cutout: '75%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            }
        }
    });
}

function updateDashboard() {
    const consumed = Math.round(current.cals);
    const pCals = Math.round(current.p * 4);
    const cCals = Math.round(current.c * 4);
    const fCals = Math.round(current.f * 9);
    const remaining = Math.max(0, targets.cals - consumed);

    document.getElementById('displayCals').innerText = consumed;
    document.getElementById('targetCals').innerText = targets.cals;
    document.getElementById('displayP').innerText = Math.round(current.p);
    document.getElementById('displayC').innerText = Math.round(current.c);
    document.getElementById('displayF').innerText = Math.round(current.f);
    
    document.getElementById('targetP').innerText = targets.p;
    document.getElementById('targetC').innerText = targets.c;
    document.getElementById('targetF').innerText = targets.f;

    document.getElementById('calFraction').innerText = `${consumed}/${targets.cals}`;

    if (donutChartInstance) {
        donutChartInstance.data.datasets[0].data = [pCals, cCals, fCals, remaining];
        donutChartInstance.data.datasets[0].backgroundColor[3] = currentTheme === 'dark' ? 'rgba(255,255,255,0.05)' : '#F3F4F6';
        donutChartInstance.update();
    }

    const calcPct = (val, target) => Math.min(100, Math.max(0, (val / target) * 100)) + '%';
    document.getElementById('barP').style.width = calcPct(current.p, targets.p);
    document.getElementById('barC').style.width = calcPct(current.c, targets.c);
    document.getElementById('barF').style.width = calcPct(current.f, targets.f);
}

// --- MODAL & EDITOR LOGIC ---

window.toggleEditMode = function() {
    const modal = document.getElementById('editModal');
    const overlay = document.getElementById('modalOverlay');
    if (modal.classList.contains('hidden')) {
        document.getElementById('editTotal').value = targets.cals;
        updateAdvancedSlidersFromGrams();
        modal.classList.remove('hidden');
        overlay.classList.remove('hidden');
        modal.classList.add('fade-in');
    } else {
        modal.classList.add('hidden');
        overlay.classList.add('hidden');
    }
};

window.switchTab = function(tab) {
    const basicContent = document.getElementById('basicTabContent');
    const advancedContent = document.getElementById('advancedTabContent');
    const basicBtn = document.getElementById('basicTabBtn');
    const advancedBtn = document.getElementById('advancedTabBtn');
    const indicator = document.getElementById('tabIndicator');

    if (tab === 'basic') {
        basicContent.classList.remove('hidden');
        advancedContent.classList.add('hidden');
        basicBtn.classList.add('text-orange-600');
        basicBtn.classList.remove('text-gray-400');
        advancedBtn.classList.remove('text-orange-600');
        advancedBtn.classList.add('text-gray-400');
        indicator.style.transform = 'translateX(0%)';
        
        basicContent.classList.remove('fade-in');
        void basicContent.offsetWidth; 
        basicContent.classList.add('fade-in');
    } else {
        advancedContent.classList.remove('hidden');
        basicContent.classList.add('hidden');
        advancedBtn.classList.add('text-orange-600');
        advancedBtn.classList.remove('text-gray-400');
        basicBtn.classList.remove('text-orange-600');
        basicBtn.classList.add('text-gray-400');
        indicator.style.transform = 'translateX(100%)';
        
        updateAdvancedSlidersFromGrams();
        advancedContent.classList.remove('fade-in');
        void advancedContent.offsetWidth; 
        advancedContent.classList.add('fade-in');
    }
};

function setupSliderListeners() {
    const sliders = ['p', 'c', 'f'];
    sliders.forEach(key => {
        const slider = document.getElementById(`slider-${key}`);
        slider?.addEventListener('input', () => handleSliderChange(key));
    });
    document.getElementById('editTotal')?.addEventListener('input', updateAdvancedGramLabels);
}

function handleSliderChange(changedKey) {
    const pVal = parseInt(document.getElementById('slider-p').value);
    const cVal = parseInt(document.getElementById('slider-c').value);
    const fVal = parseInt(document.getElementById('slider-f').value);
    
    let total = pVal + cVal + fVal;
    if (total !== 100) {
        const keys = ['p', 'c', 'f'];
        const changedIdx = keys.indexOf(changedKey);
        const nextIdx = (changedIdx + 1) % 3;
        const thirdIdx = (changedIdx + 2) % 3;
        
        let remaining = 100 - parseInt(document.getElementById(`slider-${changedKey}`).value);
        const currentNext = parseInt(document.getElementById(`slider-${keys[nextIdx]}`).value);
        const currentThird = parseInt(document.getElementById(`slider-${keys[thirdIdx]}`).value);
        const sum = currentNext + currentThird || 1;
        
        const newNext = Math.round(remaining * (currentNext / sum));
        const newThird = 100 - parseInt(document.getElementById(`slider-${changedKey}`).value) - newNext;
        
        document.getElementById(`slider-${keys[nextIdx]}`).value = newNext;
        document.getElementById(`slider-${keys[thirdIdx]}`).value = newThird;
    }
    
    updateAdvancedGramLabels();
}

function updateAdvancedSlidersFromGrams() {
    const totalCals = targets.cals;
    const pPct = Math.round((targets.p * 4 / totalCals) * 100);
    const fPct = Math.round((targets.f * 9 / totalCals) * 100);
    const cPct = 100 - pPct - fPct;

    document.getElementById('slider-p').value = pPct;
    document.getElementById('slider-c').value = cPct;
    document.getElementById('slider-f').value = fPct;
    updateAdvancedGramLabels();
}

function updateAdvancedGramLabels() {
    const total = parseInt(document.getElementById('editTotal').value) || 2000;
    const pPct = parseInt(document.getElementById('slider-p').value);
    const cPct = parseInt(document.getElementById('slider-c').value);
    const fPct = parseInt(document.getElementById('slider-f').value);

    const labels = {
        p: document.getElementById('label-p'),
        c: document.getElementById('label-c'),
        f: document.getElementById('label-f')
    };

    labels.p.innerText = `${pPct}% (${Math.round((total * pPct / 100) / 4)}g)`;
    labels.c.innerText = `${cPct}% (${Math.round((total * cPct / 100) / 4)}g)`;
    labels.f.innerText = `${fPct}% (${Math.round((total * fPct / 100) / 9)}g)`;
}

window.setGoalPreset = function(type, element) {
    const weight = parseFloat(document.getElementById('userWeight').value) || 70;
    const height = parseFloat(document.getElementById('userHeight').value) || 170;
    const age = parseInt(document.getElementById('userAge').value) || 25;
    const gender = document.getElementById('userGender').value;
    
    let bmr = (10 * weight) + (6.25 * height) - (5 * age);
    bmr += (gender === 'male' ? 5 : -161);
    let tdee = Math.round(bmr * 1.375);

    if (type === 'cut') tdee -= 400;
    if (type === 'bulk') tdee += 300;
    if (type === 'athlete') tdee += 600;

    document.getElementById('editTotal').value = tdee;
    
    let ratios = { p: 20, c: 50, f: 30 };
    if (type === 'cut') ratios = { p: 35, c: 35, f: 30 };
    if (type === 'bulk') ratios = { p: 20, c: 60, f: 20 };
    if (type === 'athlete') ratios = { p: 25, c: 50, f: 25 };

    document.getElementById('slider-p').value = ratios.p;
    document.getElementById('slider-c').value = ratios.c;
    document.getElementById('slider-f').value = ratios.f;
    updateAdvancedGramLabels();
    
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('bg-orange-600', 'text-white', 'shadow-md');
        btn.classList.add('bg-orange-50', 'text-orange-700');
    });
    element.classList.add('bg-orange-600', 'text-white', 'shadow-md');
    element.classList.remove('bg-orange-50', 'text-orange-700');
};

window.saveIntake = function() {
    const total = parseInt(document.getElementById('editTotal').value) || 2000;
    const pPct = parseInt(document.getElementById('slider-p').value);
    const cPct = parseInt(document.getElementById('slider-c').value);
    const fPct = parseInt(document.getElementById('slider-f').value);

    targets.cals = total;
    targets.p = Math.round((total * pPct / 100) / 4);
    targets.c = Math.round((total * cPct / 100) / 4);
    targets.f = Math.round((total * fPct / 100) / 9);

    saveSession(); // Persist changes
    window.toggleEditMode();
    updateDashboard();
};

// --- Fuzzy Logic Engine ---
function calculateFuzzyHealth(calories=0, protein=0, fats=0, carbs=0) {
    const tri = (val, low, peak, high) => {
        if (val <= low || val >= high) return 0;
        return val < peak ? (val - low) / (peak - low) : (high - val) / (high - peak);
    };
    const trapLow = (val, peak, high) => (val <= peak ? 1 : val >= high ? 0 : (high - val) / (high - peak));
    const trapHigh = (val, low, peak) => (val >= peak ? 1 : val <= low ? 0 : (val - low) / (peak - low));

    const f = {
        calories: { low: trapLow(calories, 150, 400), med: tri(calories, 300, 500, 700), high: trapHigh(calories, 600, 800) },
        protein: { low: trapLow(protein, 5, 10), med: tri(protein, 5, 15, 25), high: trapHigh(protein, 20, 30) },
        fats: { low: trapLow(fats, 5, 10), med: tri(fats, 5, 15, 25), high: trapHigh(fats, 20, 30) },
        carbs: { low: trapLow(carbs, 20, 40), med: tri(carbs, 30, 60, 90), high: trapHigh(carbs, 80, 100) }
    };

    let rs = { veryHealthy: 0, healthy: 0, notHealthy: 0, junk: 0 };
    rs.veryHealthy = Math.max(rs.veryHealthy, Math.min(f.protein.high, f.fats.low));
    rs.healthy = Math.max(rs.healthy, Math.min(f.protein.med, f.carbs.med, f.fats.med));
    rs.junk = Math.max(rs.junk, Math.min(f.fats.high, f.carbs.high));
    rs.notHealthy = Math.max(rs.notHealthy, 0.1); 

    const num = (rs.veryHealthy * 90) + (rs.healthy * 65) + (rs.notHealthy * 35) + (rs.junk * 15);
    const den = rs.veryHealthy + rs.healthy + rs.notHealthy + rs.junk;
    const score = den === 0 ? 50 : num / den;

    if (score >= 80) return { score, category: "Very Healthy", colorName: "emerald" };
    if (score >= 60) return { score, category: "Healthy", colorName: "green" };
    if (score >= 35) return { score, category: "Not Healthy", colorName: "orange" };
    return { score, category: "Junk Food", colorName: "red" };
}

window.toggleGraphModal = function() {
    const modal = document.getElementById('graphModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (!chartInstance) initChart();
    } else {
        modal.classList.add('hidden');
    }
};

function initChart() {
    const ctx = document.getElementById('fuzzyChart').getContext('2d');
    const labels = Array.from({length: 101}, (_, i) => i);
    const junkData = labels.map(x => (x <= 15 ? 1 : x >= 35 ? 0 : (35 - x) / 20));
    const notHealthyData = labels.map(x => (x <= 15 || x >= 55 ? 0 : x <= 35 ? (x - 15) / 20 : (55 - x) / 20));
    const healthyData = labels.map(x => (x <= 35 || x >= 85 ? 0 : x <= 60 ? (x - 35) / 25 : (85 - x) / 25));
    const veryHealthyData = labels.map(x => (x <= 60 ? 0 : x >= 85 ? 1 : (x - 60) / 25));

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Junk', data: junkData, borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, pointRadius: 0 },
                { label: 'Not Healthy', data: notHealthyData, borderColor: '#F97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', fill: true, pointRadius: 0 },
                { label: 'Healthy', data: healthyData, borderColor: '#22C55E', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, pointRadius: 0 },
                { label: 'Very Healthy', data: veryHealthyData, borderColor: '#15803D', backgroundColor: 'rgba(21, 128, 61, 0.1)', fill: true, pointRadius: 0 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { display: false, max: 1.1 },
                x: { title: { display: true, text: 'Health Score (0-100)' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateChart() { chartInstance?.update(); }