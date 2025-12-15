const API_URL = "http://localhost:8000/analyze"; 

// --- State Management ---
let targets = { cals: 2000, p: 150, c: 200, f: 65 };
let current = { cals: 0, p: 0, c: 0, f: 0 };
let history = [];
let chartInstance = null;
let lastScore = 50; // Default score for graph line
let lastDeleted = null; // Stores the deleted item for Undo

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    updateDashboard(); // Set initial zeros
    
    // Scan Button
    const scanBtn = document.getElementById('scanBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', analyzeFood);
    }

    // Enter Key Support
    const userInput = document.getElementById('userInput');
    if (userInput) {
        userInput.addEventListener('keypress', (e) => {
            if(e.key === 'Enter' && !e.shiftKey) { 
                e.preventDefault(); 
                analyzeFood(); 
            }
        });
    }
});

// --- Core API Analysis ---
async function analyzeFood() {
    const input = document.getElementById('userInput').value;
    const btn = document.getElementById('scanBtn');
    const status = document.getElementById('statusMsg');

    if (!input.trim()) return;

    // UI Loading State
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    status.classList.remove('hidden');
    
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: input }) 
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Server Error");
        }

        const data = await response.json();
        const items = Array.isArray(data) ? data : [data];
        
        items.forEach(item => {
            // Update State
            history.unshift(item);
            current.cals += item.calories || 0;
            current.p += item.protein || 0;
            current.c += item.carbs || 0;
            current.f += item.fats || 0;
            
            // Calculate Fuzzy Score for Graph Position
            const fuzzyRes = calculateFuzzyHealth(
                item.calories || 0,
                item.protein || 0,
                item.fats || 0,
                item.carbs || 0
            );
            lastScore = fuzzyRes.score;
        });

        // Update UI
        renderHistory();
        updateDashboard();
        updateChart(); // Refresh chart if modal is open

        // Clear Undo state on new add (optional, but cleaner UX)
        lastDeleted = null;
        const undoBtn = document.getElementById('undoBtn');
        if(undoBtn) undoBtn.classList.add('hidden');

    } catch (error) {
        console.error(error);
        alert("Error: " + error.message);
    } finally {
        // Reset UI
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i><span>Analyze</span>`;
        status.classList.add('hidden');
        document.getElementById('userInput').value = ''; 
    }
}

// --- UI Rendering Functions ---

function renderHistory() {
    const list = document.getElementById('foodLog');
    const countEl = document.getElementById('itemCount');
    
    list.innerHTML = '';
    countEl.innerText = `${history.length} items`;

    history.forEach((item, index) => {
        // Run Fuzzy Logic per item to get category color
        const fuzzy = calculateFuzzyHealth(item.calories, item.protein, item.fats, item.carbs);
        
        const li = document.createElement('li');
        li.className = "bg-white p-4 rounded-2xl border border-green-100 shadow-sm fade-in group relative hover:shadow-md transition-all";
        li.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <i class="fa-solid fa-plus text-green-500 text-xs"></i>
                        <span class="font-bold text-gray-800 capitalize text-base">${item.food_name}</span>
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

// Make globally accessible for HTML onclick buttons
window.deleteItem = function(index) {
    const item = history[index];
    
    // 1. Save state for Undo
    lastDeleted = { item: item, index: index };

    // 2. Remove values
    current.cals -= item.calories;
    current.p -= item.protein;
    current.c -= item.carbs;
    current.f -= item.fats;
    
    history.splice(index, 1);
    
    // 3. Show Undo Button
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) {
        undoBtn.classList.remove('hidden');
        undoBtn.classList.add('fade-in');
    }

    renderHistory();
    updateDashboard();
};

window.undoDelete = function() {
    if (!lastDeleted) return;

    const { item, index } = lastDeleted;

    // 1. Restore Values
    current.cals += item.calories;
    current.p += item.protein;
    current.c += item.carbs;
    current.f += item.fats;

    // 2. Restore Item to original position
    // Use splice to insert back exactly where it was
    if (index >= 0 && index <= history.length) {
        history.splice(index, 0, item);
    } else {
        history.push(item); // Fallback
    }

    // 3. Clear state & Hide Button
    lastDeleted = null;
    document.getElementById('undoBtn').classList.add('hidden');

    renderHistory();
    updateDashboard();
};

function updateDashboard() {
    // Text Updates
    document.getElementById('displayCals').innerText = Math.round(current.cals);
    document.getElementById('targetCals').innerText = targets.cals;
    document.getElementById('displayP').innerText = Math.round(current.p);
    document.getElementById('targetP').innerText = targets.p;
    document.getElementById('displayC').innerText = Math.round(current.c);
    document.getElementById('targetC').innerText = targets.c;
    document.getElementById('displayF').innerText = Math.round(current.f);
    document.getElementById('targetF').innerText = targets.f;

    // Helper for percentage width
    const calcPct = (val, target) => Math.min(100, Math.max(0, (val / target) * 100)) + '%';
    
    // Macro Lines
    document.getElementById('lineP').style.width = calcPct(current.p, targets.p);
    document.getElementById('lineC').style.width = calcPct(current.c, targets.c);
    document.getElementById('lineF').style.width = calcPct(current.f, targets.f);

    // Stacked Total Bar
    // We normalize macros to calories (P=4, C=4, F=9) relative to total target
    const pCals = current.p * 4;
    const cCals = current.c * 4;
    const fCals = current.f * 9;
    
    document.getElementById('barP').style.width = ((pCals / targets.cals) * 100) + '%';
    document.getElementById('barC').style.width = ((cCals / targets.cals) * 100) + '%';
    document.getElementById('barF').style.width = ((fCals / targets.cals) * 100) + '%';
    
    document.getElementById('calPercent').innerText = Math.round((current.cals / targets.cals) * 100) + '%';
}

// --- Edit Mode Logic ---

window.toggleEditMode = function() {
    const view = document.getElementById('trackerView');
    const edit = document.getElementById('trackerEdit');
    
    if (edit.classList.contains('hidden')) {
        // Open Edit
        document.getElementById('editTotal').value = targets.cals;
        document.getElementById('editP').value = targets.p;
        document.getElementById('editC').value = targets.c;
        document.getElementById('editF').value = targets.f;
        
        view.classList.add('hidden');
        edit.classList.remove('hidden');
    } else {
        // Close Edit
        edit.classList.add('hidden');
        view.classList.remove('hidden');
    }
};

window.saveProfile = function() {
    targets.cals = parseInt(document.getElementById('editTotal').value) || 2000;
    targets.p = parseInt(document.getElementById('editP').value) || 150;
    targets.c = parseInt(document.getElementById('editC').value) || 200;
    targets.f = parseInt(document.getElementById('editF').value) || 65;
    
    window.toggleEditMode();
    updateDashboard();
};

window.calculateBMR = function() {
    const w = parseFloat(document.getElementById('userWeight').value);
    const h = parseFloat(document.getElementById('userHeight').value);
    const a = parseFloat(document.getElementById('userAge').value);
    const g = document.getElementById('userGender').value;
    
    // Mifflin-St Jeor
    let bmr = (10 * w) + (6.25 * h) - (5 * a);
    bmr += (g === 'male') ? 5 : -161;
    
    // TDEE (Moderate exercise assumption)
    const tdee = Math.round(bmr * 1.375);
    setTargetsFromCals(tdee);
};

window.setGoal = function(type) {
    let base = parseInt(document.getElementById('editTotal').value) || 2000;
    if (type === 'cut') base -= 300;
    if (type === 'bulk') base += 300;
    if (type === 'athlete') base += 500;
    setTargetsFromCals(base, type);
};

function setTargetsFromCals(cals, type='maintain') {
    document.getElementById('editTotal').value = cals;
    let pR = 0.3, cR = 0.4, fR = 0.3;
    if (type === 'cut') { pR = 0.4; cR = 0.3; fR = 0.3; }
    if (type === 'bulk') { pR = 0.3; cR = 0.5; fR = 0.2; }
    if (type === 'athlete') { pR = 0.25; cR = 0.55; fR = 0.2; }

    document.getElementById('editP').value = Math.round((cals * pR) / 4);
    document.getElementById('editC').value = Math.round((cals * cR) / 4);
    document.getElementById('editF').value = Math.round((cals * fR) / 9);
}

// --- Fuzzy Logic Engine ---

function calculateFuzzyHealth(calories=0, protein=0, fats=0, carbs=0) {
    
    // 1. FUZZIFICATION (Membership Functions)
    const tri = (val, low, peak, high) => {
        if (val <= low || val >= high) return 0;
        if (val === peak) return 1;
        if (val < peak) return (val - low) / (peak - low);
        return (high - val) / (high - peak);
    };
    const trapLow = (val, peak, high) => (val <= peak ? 1 : val >= high ? 0 : (high - val) / (high - peak));
    const trapHigh = (val, low, peak) => (val >= peak ? 1 : val <= low ? 0 : (val - low) / (peak - low));

    const f = {
        calories: {
            low: trapLow(calories, 150, 400),
            med: tri(calories, 300, 500, 700),
            high: trapHigh(calories, 600, 800)
        },
        protein: {
            low: trapLow(protein, 5, 10),
            med: tri(protein, 5, 15, 25),
            high: trapHigh(protein, 20, 30)
        },
        fats: {
            low: trapLow(fats, 5, 10),
            med: tri(fats, 5, 15, 25),
            high: trapHigh(fats, 20, 30)
        },
        carbs: {
            low: trapLow(carbs, 20, 40),
            med: tri(carbs, 30, 60, 90),
            high: trapHigh(carbs, 80, 100)
        }
    };

    // 2. RULE EVALUATION
    let rs = { veryHealthy: 0, healthy: 0, notHealthy: 0, junk: 0 };

    rs.veryHealthy = Math.max(rs.veryHealthy, Math.min(f.protein.high, f.fats.low));
    rs.healthy = Math.max(rs.healthy, Math.min(f.protein.med, f.carbs.med, f.fats.med));
    rs.veryHealthy = Math.max(rs.veryHealthy, Math.min(f.calories.low, f.protein.high));
    rs.junk = Math.max(rs.junk, Math.min(f.fats.high, f.carbs.high));
    rs.notHealthy = Math.max(rs.notHealthy, Math.min(f.calories.high, f.protein.low));
    rs.junk = Math.max(rs.junk, Math.min(f.carbs.high, f.protein.low));
    const r7 = Math.min(f.calories.low, Math.max(f.fats.low, f.fats.med), Math.max(f.carbs.low, f.carbs.med));
    rs.healthy = Math.max(rs.healthy, r7);
    rs.veryHealthy = Math.max(rs.veryHealthy, Math.min(f.calories.low, f.protein.med));
    rs.notHealthy = Math.max(rs.notHealthy, 0.1); 

    // 3. DEFUZZIFICATION
    const num = (rs.veryHealthy * 90) + (rs.healthy * 65) + (rs.notHealthy * 35) + (rs.junk * 15);
    const den = rs.veryHealthy + rs.healthy + rs.notHealthy + rs.junk;
    const score = den === 0 ? 50 : num / den;

    // 4. CATEGORIZATION
    if (score >= 80) return { score, category: "Very Healthy", colorName: "emerald", colorClass: "text-emerald-400" };
    if (score >= 60) return { score, category: "Healthy", colorName: "green", colorClass: "text-green-400" };
    if (score >= 35) return { score, category: "Not Healthy", colorName: "orange", colorClass: "text-orange-400" };
    return { score, category: "Junk Food", colorName: "red", colorClass: "text-red-500" };
}

// --- Graph Visuals (Chart.js) ---

window.toggleGraphModal = function() {
    const modal = document.getElementById('graphModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (!chartInstance) initChart();
        else updateChart();
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

function initChart() {
    const ctx = document.getElementById('fuzzyChart').getContext('2d');
    
    const labels = Array.from({length: 101}, (_, i) => i);
    
    // Trapezoidal Logic Visualization
    const junkData = labels.map(x => (x <= 15 ? 1 : x >= 35 ? 0 : (35 - x) / 20));
    const notHealthyData = labels.map(x => (x <= 15 || x >= 55 ? 0 : x <= 35 ? (x - 15) / 20 : (55 - x) / 20));
    const healthyData = labels.map(x => (x <= 35 || x >= 85 ? 0 : x <= 60 ? (x - 35) / 25 : (85 - x) / 25));
    const veryHealthyData = labels.map(x => (x <= 60 ? 0 : x >= 85 ? 1 : (x - 60) / 25));

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
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
                y: { beginAtZero: true, max: 1.1, title: { display: true, text: 'Membership' }, ticks: { display: false } },
                x: { title: { display: true, text: 'Health Score (0-100)' } }
            },
            plugins: {
                legend: { position: 'top' }
            }
        },
        plugins: [{
            id: 'currentScoreLine',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                const x = xAxis.getPixelForValue(lastScore);
                
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, yAxis.top);
                ctx.lineTo(x, yAxis.bottom);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#000';
                ctx.setLineDash([5, 5]);
                ctx.stroke();
                
                ctx.font = 'bold 12px Inter';
                ctx.fillStyle = '#000';
                ctx.textAlign = 'center';
                ctx.fillText(`Score: ${Math.round(lastScore)}`, x, yAxis.top - 5);
                ctx.restore();
            }
        }]
    });
}

function updateChart() {
    if (chartInstance) {
        chartInstance.update();
    }
}