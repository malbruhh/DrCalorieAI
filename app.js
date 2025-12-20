const API_URL = "http://localhost:8000/analyze"; 

// --- Default State Management ---
let targets = { 
    cals: 2000, 
    p: 100, 
    c: 250, 
    f: 66 
}; 
let current = { cals: 0, p: 0, c: 0, f: 0, s: 0 };
let history = [];
let chartInstance = null; 
let donutChartInstance = null; 
let lastScore = 50; 
let currentImageBase64 = null; 
let currentTheme = 'light';
let lastDeletedItem = null;
let undoTimer = null;
let outputChart = null;
const MAX_HISTORY_LENGTH = 100;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('nutriscan_theme') || 'light';
    applyTheme(savedTheme);
    loadSession();
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
    
    // ✅ FIX: Prevent modal close when clicking inside modal content
    document.getElementById('editModal')?.addEventListener('click', (e) => {
        e.stopPropagation();
    });
});

// --- Theme Logic ---
window.toggleTheme = function() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
};

function applyTheme(theme) {
    currentTheme = theme;
    try {
        localStorage.setItem('nutriscan_theme', theme);
    } catch (e) {
        console.warn('Theme preference could not be saved:', e);
    }
    
    const body = document.body;
    const themeIcon = document.getElementById('themeIcon');

    if (theme === 'dark') {
        body.classList.add('theme-dark');
        if (themeIcon) {
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
        }
    } else {
        body.classList.remove('theme-dark');
        if (themeIcon) {
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        }
    }
    updateDashboard();
}

// --- Persistence Logic ---
function saveSession() {
    try {
        const sessionData = { targets, history, current };
        localStorage.setItem('nutriscan_session', JSON.stringify(sessionData));
    } catch (e) { 
        console.error("Save error:", e);
        // Could show user notification here
    }
}

function loadSession() {
    const savedData = localStorage.getItem('nutriscan_session');
    if (savedData) {
        try {
            const data = JSON.parse(savedData);
            targets = data.targets || targets;
            history = data.history || [];
            
            // ✅ FIX: Enforce MAX_HISTORY_LENGTH on load
            if (history.length > MAX_HISTORY_LENGTH) {
                history = history.slice(0, MAX_HISTORY_LENGTH);
                console.warn(`History truncated to ${MAX_HISTORY_LENGTH} items`);
            }
            
            current = data.current || { cals: 0, p: 0, c: 0, f: 0, s: 0 };
            renderHistory();
        } catch (e) { 
            console.error("Load error:", e);
            // Reset to defaults on corrupt data
            history = [];
            current = { cals: 0, p: 0, c: 0, f: 0, s: 0 };
        }
    }
}

// --- Core API Analysis ---
async function analyzeFood() {
    const input = document.getElementById('userInput').value;
    const btn = document.getElementById('scanBtn');
    const status = document.getElementById('statusMsg');

    if (!input.trim() && !currentImageBase64) {
        alert('Please enter a food description or upload an image.');
        return;
    }

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

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Server Error' }));
            
            // ✅ FIX: Better error messages
            if (response.status === 429) {
                throw new Error("Rate limit exceeded. Please wait a moment and try again.");
            } else if (response.status === 401) {
                throw new Error("API authentication failed. Check your API key.");
            } else if (response.status === 500) {
                throw new Error(errorData.detail || "Server error occurred");
            } else {
                throw new Error(errorData.detail || `Server returned ${response.status}`);
            }
        }

        const data = await response.json();
        const items = Array.isArray(data) ? data : [data];
        
        if (items.length === 0) {
            throw new Error("No food items were recognized. Please try again.");
        }
        
        items.forEach(item => {
            // ✅ FIX: Validate item structure
            if (!item || typeof item !== 'object') {
                console.warn('Skipping invalid item:', item);
                return;
            }
            
            history.unshift(item);
            if (history.length > MAX_HISTORY_LENGTH) history.pop(); 

            // ✅ FIX: Force numeric conversion to prevent string concatenation
            current.cals += Number(item.calories) || 0;
            current.p += Number(item.protein) || 0;
            current.c += Number(item.carbs) || 0;
            current.f += Number(item.fats) || 0;
            current.s += Number(item.sugar) || 0;
            
            const fuzzyRes = calculateFuzzyHealth(
                Number(item.calories) || 0,
                Number(item.protein) || 0,
                Number(item.fats) || 0,
                Number(item.sugar) || 0
            );
            
            if (!fuzzyRes || !fuzzyRes.mf) {
                console.warn('Fuzzy calculation failed for item:', item);
                return;
            }
            
            drawFuzzyGraph("calGraph", fuzzyRes.mf.cal, getDominant(fuzzyRes.mf.cal));
            drawFuzzyGraph("proGraph", fuzzyRes.mf.pro, getDominant(fuzzyRes.mf.pro));
            drawFuzzyGraph("fatGraph", fuzzyRes.mf.fat, getDominant(fuzzyRes.mf.fat));
            drawFuzzyGraph("sugGraph", fuzzyRes.mf.sug, getDominant(fuzzyRes.mf.sug));

            updateSugenoUI(fuzzyRes.rules, fuzzyRes.score);
            lastScore = fuzzyRes.score;
        });
        
        saveSession();
        renderHistory();
        updateDashboard();
        updateChart(); 
        clearImage();
        selectFoodItem(0);
        document.getElementById('userInput').value = ''; 

    } catch (error) {
        console.error('Analysis error:', error);
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `Analyze <i class="fa-solid fa-sparkles text-sm"></i>`;
        status?.classList.add('hidden');
    }
}

// --- Sugeno Fuzzy Logic Implementation ---
function calculateFuzzyHealth(calories = 0, protein = 0, fats = 0, sugar = 0) {
    // ✅ FIX: Force numeric conversion and validate inputs
    calories = Number(calories) || 0;
    protein = Number(protein) || 0;
    fats = Number(fats) || 0;
    sugar = Number(sugar) || 0;
    
    // Validate inputs are reasonable numbers
    if (isNaN(calories) || isNaN(protein) || isNaN(fats) || isNaN(sugar)) {
        console.error('Invalid numeric inputs:', { calories, protein, fats, sugar });
        return {
            score: 50,
            category: "Unknown",
            colorName: "gray",
            mf: {
                cal: { low: 0, med: 0, high: 0 },
                pro: { low: 0, med: 0, high: 0 },
                fat: { low: 0, high: 0 },
                sug: { low: 0, med: 0, high: 0 }
            },
            rules: []
        };
    }
    
    // 1. FUZZIFICATION
    const trapLow = (x, peak, high) => (x <= peak ? 1 : x >= high ? 0 : (high - x) / (high - peak));
    const tri = (x, low, peak, high) => (x <= low || x >= high) ? 0 : (x < peak ? (x - low) / (peak - low) : (high - x) / (high - peak));
    const trapHigh = (x, low, peak) => (x >= peak ? 1 : x <= low ? 0 : (x - low) / (peak - low));

    const mf = {
        cal: { 
            low: trapLow(calories, 100, 300), 
            med: tri(calories, 200, 500, 800), 
            high: trapHigh(calories, 700, 950) 
        },
        pro: { 
            low: trapLow(protein, 5, 12), 
            med: tri(protein, 10, 25, 40), 
            high: trapHigh(protein, 30, 50) 
        },
        fat: { 
            low: trapLow(fats, 5, 16), 
            high: trapHigh(fats, 15, 35) 
        },
        sug: { 
            low: trapLow(sugar, 5, 10), 
            med: tri(sugar, 8, 18, 28), 
            high: trapHigh(sugar, 22, 35) 
        }
    };

    // 2. RULE EVALUATION (Sugeno Singletons)
    const Z_VERY_HEALTHY = 95, Z_HEALTHY = 75, Z_NOT_HEALTHY = 40, Z_JUNK = 10;
    let rules = [];

    // RULES: Junk Food (Z=10)
    rules.push([mf.sug.high, Z_JUNK]);
    rules.push([Math.min(mf.cal.high, mf.sug.med), Z_JUNK]);
    rules.push([Math.min(mf.fat.high, mf.pro.low), Z_JUNK]);

    // RULES: Not Healthy (Z=40)
    rules.push([Math.min(mf.sug.med, mf.pro.low), Z_NOT_HEALTHY]);
    rules.push([Math.min(mf.cal.high, mf.pro.med), Z_NOT_HEALTHY]);
    rules.push([Math.min(mf.fat.high, mf.sug.low), Z_NOT_HEALTHY]);

    // RULES: Healthy (Z=75)
    rules.push([Math.min(mf.cal.low, mf.sug.low), Z_HEALTHY]);
    rules.push([Math.min(mf.pro.med, mf.sug.low), Z_HEALTHY]);
    rules.push([Math.min(mf.cal.med, mf.pro.med), Z_HEALTHY]);

    // RULES: Very Healthy (Z=95)
    rules.push([Math.min(mf.pro.high, mf.sug.low, mf.fat.low), Z_VERY_HEALTHY]);
    rules.push([Math.min(mf.cal.low, mf.pro.high), Z_VERY_HEALTHY]);

    // 3. DEFUZZIFICATION (Weighted Average)
    let sumWeight = 0, sumWeightedValue = 0;
    rules.forEach(([w, z]) => {
        sumWeightedValue += (w * z);
        sumWeight += w;
    });

    // Default to middle-ground if no rules fire
    const score = sumWeight === 0 ? 50 : (sumWeightedValue / sumWeight);
    
    // ✅ FIX: Validate final score
    const finalScore = isNaN(score) ? 50 : Math.max(0, Math.min(100, score));

    // 4. OUTPUT CATEGORIZATION
    let category, colorName;

    if (finalScore >= 85) {
        category = "Very Healthy";
        colorName = "emerald";
    } else if (finalScore >= 60) {
        category = "Healthy";
        colorName = "green";
    } else if (finalScore >= 35) {
        category = "Not Healthy";
        colorName = "orange";
    } else {
        category = "Junk Food";
        colorName = "red";
    }

    return {
        score: finalScore,
        category,
        colorName,
        mf,
        rules
    };
}

const fuzzyCharts = {};

function getDominant(mf) {
    return Object.entries(mf).reduce((a,b)=> a[1] > b[1] ? a : b)[0];
}

// Fuzzy Graph 
function drawFuzzyGraph(id, mf, dominant) {
    if (fuzzyCharts[id]) fuzzyCharts[id].destroy();

    const ctx = document.getElementById(id)?.getContext("2d");
    if (!ctx) {
        console.warn(`Canvas ${id} not found`);
        return;
    }

    fuzzyCharts[id] = new Chart(ctx, {
        type: "bar",
        data: {
            labels: Object.keys(mf),
            datasets: [{
                data: Object.values(mf),
                backgroundColor: Object.keys(mf).map(k =>
                    k === dominant
                        ? "rgba(34,197,94,0.45)"
                        : "rgba(239,68,68,0.15)"
                )
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { min: 0, max: 1 } }
        }
    });
}

function updateSugenoUI(rules, score) {
    let num = 0, den = 0;
    rules.forEach(([w,z]) => {
        num += w * z;
        den += w;
    });

    const sugenoElem = document.getElementById("sugenoCalc");
    if (sugenoElem) {
        sugenoElem.innerHTML = `
            <strong>Sugeno Weighted Average</strong><br>
            Σ(w × z) = ${num.toFixed(2)}<br>
            Σ(w) = ${den.toFixed(2)}<br>
            <strong>Result = ${score.toFixed(1)}</strong>
        `;
    }

    if (outputChart) outputChart.destroy();

    const ctx = document.getElementById("outputGraph")?.getContext("2d");
    if (!ctx) return;
    
    outputChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Junk", "Not Healthy", "Healthy", "Very Healthy"],
            datasets: [{
                data: [10, 40, 75, 95],
                backgroundColor: ["#dc2626","#f59e0b","#22c55e","#15803d"]
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { min: 0, max: 100 } }
        }
    });
}

// --- UI Rendering ---
function renderHistory() {
    const list = document.getElementById('foodLog');
    if (!list) return;
    list.innerHTML = '';
    document.getElementById('itemCount').innerText = `${history.length} items`;

    history.forEach((item, index) => {
        const fuzzy = calculateFuzzyHealth(
            Number(item.calories) || 0, 
            Number(item.protein) || 0, 
            Number(item.fats) || 0, 
            Number(item.sugar) || 0
        );
        
        const li = document.createElement('li');
        li.className = "item-card food-item p-4 rounded-2xl shadow-sm fade-in group relative hover:shadow-md transition-all";
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
                <button onclick="deleteItem(${index})" class="text-gray-300 hover:text-red-500 transition px-2"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="flex gap-2 text-xs pl-5 overflow-x-auto no-scrollbar">
                <span class="badge-p px-2 py-1 rounded-lg font-mono font-medium">${item.protein}g P</span>
                <span class="badge-c px-2 py-1 rounded-lg font-mono font-medium">${item.carbs}g C</span>
                <span class="badge-f px-2 py-1 rounded-lg font-mono font-medium">${item.fats}g F</span>
            </div>
        `;
        li.addEventListener("click", () => {
            selectFoodItem(index);
        });
        list.appendChild(li);
    });
}

window.deleteItem = function(index) {
    const item = history[index];
    lastDeletedItem = { item, index };

    current.cals -= Number(item.calories) || 0;
    current.p -= Number(item.protein) || 0;
    current.c -= Number(item.carbs) || 0;
    current.f -= Number(item.fats) || 0;
    current.s -= Number(item.sugar) || 0;

    history.splice(index, 1);
    saveSession();
    renderHistory();
    updateDashboard();

    const undoBtn = document.getElementById("undoBtn");
    undoBtn.classList.remove("hidden");

    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
        lastDeletedItem = null;
        undoBtn.classList.add("hidden");
    }, 5000);
};

document.getElementById("undoBtn").onclick = () => {
    if (!lastDeletedItem) return;

    history.splice(lastDeletedItem.index, 0, lastDeletedItem.item);
    
    // Restore to current totals
    current.cals += Number(lastDeletedItem.item.calories) || 0;
    current.p += Number(lastDeletedItem.item.protein) || 0;
    current.c += Number(lastDeletedItem.item.carbs) || 0;
    current.f += Number(lastDeletedItem.item.fats) || 0;
    current.s += Number(lastDeletedItem.item.sugar) || 0;
    
    lastDeletedItem = null;

    saveSession();
    renderHistory();
    updateDashboard();
    document.getElementById("undoBtn").classList.add("hidden");
};

function initDonutChart() {
    const canvas = document.getElementById('calorieDonut');
    if (!canvas) {
        console.warn('Donut chart canvas not found');
        return;
    }
    
    try {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('Could not get 2D context for donut chart');
            return;
        }
        
        donutChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Protein', 'Carbs', 'Fat', 'Remaining'],
                datasets: [{
                    data: [0, 0, 0, targets.cals],
                    backgroundColor: ['#EF4444', '#3B82F6', '#EAB308', '#94a3b8'],
                    borderWidth: 0,
                    hoverOffset: 4,
                    cutout: '75%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: true } }
            }
        });
    } catch (error) {
        console.error('Error initializing donut chart:', error);
    }
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
        donutChartInstance.data.datasets[0].backgroundColor[3] = (currentTheme === 'dark') ? 'rgba(255, 255, 255, 0.2)' : '#94a3b8';
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
    } else {
        advancedContent.classList.remove('hidden');
        basicContent.classList.add('hidden');
        advancedBtn.classList.add('text-orange-600');
        advancedBtn.classList.remove('text-gray-400');
        basicBtn.classList.remove('text-orange-600');
        basicBtn.classList.add('text-gray-400');
        indicator.style.transform = 'translateX(100%)';
        updateAdvancedSlidersFromGrams();
    }
};

function setupSliderListeners() {
    ['p', 'c', 'f'].forEach(key => {
        document.getElementById(`slider-${key}`)?.addEventListener('input', () => handleSliderChange(key));
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
    document.getElementById('label-p').innerText = `${pPct}% (${Math.round((total * pPct / 100) / 4)}g)`;
    document.getElementById('label-c').innerText = `${cPct}% (${Math.round((total * cPct / 100) / 4)}g)`;
    document.getElementById('label-f').innerText = `${fPct}% (${Math.round((total * fPct / 100) / 9)}g)`;
}

window.setGoalPreset = function(type, element) {
    const weight = parseFloat(document.getElementById('userWeight').value) || 70;
    const height = parseFloat(document.getElementById('userHeight').value) || 170;
    const age = parseInt(document.getElementById('userAge').value) || 25;
    const gender = document.getElementById('userGender').value;
    let bmr = (10 * weight) + (6.25 * height) - (5 * age) + (gender === 'male' ? 5 : -161);
    let tdee = Math.round(bmr * 1.375);
    if (type === 'cut') tdee -= 400;
    else if (type === 'bulk') tdee += 300;
    else if (type === 'athlete') tdee += 600;
    document.getElementById('editTotal').value = tdee;
    let ratios = { p: 20, c: 50, f: 30 };
    if (type === 'cut') ratios = { p: 35, c: 35, f: 30 };
    else if (type === 'bulk') ratios = { p: 20, c: 60, f: 20 };
    else if (type === 'athlete') ratios = { p: 25, c: 50, f: 25 };
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
    saveSession();
    window.toggleEditMode();
    updateDashboard();
};

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // ✅ FIX: Validate file type and size
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
        alert('Please upload a valid image file (JPEG, PNG, WebP, or GIF)');
        event.target.value = '';
        return;
    }
    
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        alert('Image size must be less than 10MB');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        currentImageBase64 = e.target.result;
        const container = document.getElementById('imagePreviewContainer');
        document.getElementById('previewImg').src = currentImageBase64;
        container.classList.remove('hidden');
        container.classList.add('flex');
    };
    reader.onerror = () => {
        alert('Failed to read image file');
        event.target.value = '';
    };
    reader.readAsDataURL(file);
}

window.clearImage = function() {
    currentImageBase64 = null;
    document.getElementById('imageInput').value = ""; 
    document.getElementById('imagePreviewContainer').classList.add('hidden');
};

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

let selectedFoodIndex = null;

function selectFoodItem(index) {
    selectedFoodIndex = index;

    document.querySelectorAll(".food-item").forEach((el, i) => {
        el.classList.toggle("active", i === index);
    });

    const item = history[index];
    if (!item) return;

    const fuzzyRes = calculateFuzzyHealth(
        Number(item.calories) || 0,
        Number(item.protein) || 0,
        Number(item.fats) || 0,
        Number(item.sugar) || 0
    );

    drawFuzzyGraph("calGraph", fuzzyRes.mf.cal, getDominant(fuzzyRes.mf.cal));
    drawFuzzyGraph("proGraph", fuzzyRes.mf.pro, getDominant(fuzzyRes.mf.pro));
    drawFuzzyGraph("fatGraph", fuzzyRes.mf.fat, getDominant(fuzzyRes.mf.fat));
    drawFuzzyGraph("sugGraph", fuzzyRes.mf.sug, getDominant(fuzzyRes.mf.sug));

    updateSugenoUI(fuzzyRes.rules, fuzzyRes.score);

    animateGraphs();
}

function animateGraphs() {
    ["calGraph", "proGraph", "fatGraph", "sugGraph", "outputGraph"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.classList.remove("graph-animate");
        void el.offsetWidth;
        el.classList.add("graph-animate");
    });
}

function initChart() {
    const canvas = document.getElementById('fuzzyChart');
    if (!canvas) {
        console.warn('Fuzzy chart canvas not found');
        return;
    }
    
    try {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('Could not get 2D context for fuzzy chart');
            return;
        }
        
        const labels = Array.from({length: 101}, (_, i) => i);
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Junk', data: labels.map(x => x <= 15 ? 1 : x >= 35 ? 0 : (35 - x) / 20), borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, pointRadius: 0 },
                    { label: 'Not Healthy', data: labels.map(x => x <= 15 || x >= 55 ? 0 : x <= 35 ? (x - 15) / 20 : (55 - x) / 20), borderColor: '#F97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', fill: true, pointRadius: 0 },
                    { label: 'Healthy', data: labels.map(x => x <= 35 || x >= 85 ? 0 : x <= 60 ? (x - 35) / 25 : (85 - x) / 25), borderColor: '#22C55E', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, pointRadius: 0 },
                    { label: 'Very Healthy', data: labels.map(x => x <= 60 ? 0 : x >= 85 ? 1 : (x - 60) / 25), borderColor: '#15803D', backgroundColor: 'rgba(21, 128, 61, 0.1)', fill: true, pointRadius: 0 }
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
    } catch (error) {
        console.error('Error initializing fuzzy chart:', error);
    }
}

function updateChart() { 
    if (chartInstance) chartInstance.update(); 
}