const API_URL = "http://localhost:8000/analyze"; 

// --- Event Listener setup ---
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('scanBtn');
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            analyzeFood();
        });
    }
});

async function analyzeFood() {
    const input = document.getElementById('userInput').value;
    const btn = document.getElementById('scanBtn');
    const status = document.getElementById('statusMsg');
    const resultArea = document.getElementById('resultsArea');

    if (!input.trim()) return;

    // UI Loading State
    btn.disabled = true;
    btn.innerHTML = `<span class="thinking-pulse w-3 h-3 bg-white rounded-full inline-block mr-2"></span> Processing...`;
    status.innerText = "Analyzing nutrition data...";
    status.classList.remove('hidden', 'text-red-400');
    
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
        
        displayResult(data);
        resultArea.classList.remove('hidden');
        status.classList.add('hidden');

    } catch (error) {
        console.error(error);
        status.innerText = "Error: " + error.message;
        status.classList.add('text-red-400');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span>Scan Calories</span>`;
    }
}

function displayResult(dataInput) {
    // Handle both array (multiple items) and single object
    const items = Array.isArray(dataInput) ? dataInput : [dataInput];

    // Variables for Aggregate Totals
    let totalCals = 0;
    let totalP = 0;
    let totalC = 0;
    let totalF = 0;
    
    const logList = document.getElementById('foodLog');

    // 1. Process Individual Items
    items.forEach(item => {
        // Add to totals
        totalCals += item.calories || 0;
        totalP += item.protein || 0;
        totalC += item.carbs || 0;
        totalF += item.fats || 0;

        // Calculate Fuzzy Score for THIS specific item
        const itemFuzzy = calculateFuzzyHealth(
            item.calories || 0,
            item.protein || 0,
            item.fats || 0,
            item.carbs || 0
        );

        // Create List Element
        const li = document.createElement('li');
        li.className = "bg-slate-800 p-3 rounded-lg border border-slate-700 flex justify-between items-center text-sm mb-2";
        li.innerHTML = `
            <div>
                <span class="font-bold text-white block">${item.food_name}</span>
                <span class="text-xs text-${itemFuzzy.colorName}-400">${itemFuzzy.category}</span>
            </div>
            <div class="text-right">
                <span class="text-blue-400 font-mono block">${item.calories} kcal</span>
                <span class="text-xs text-slate-500">
                    P:${item.protein}g C:${item.carbs}g F:${item.fats}g
                </span>
            </div>
        `;
        logList.prepend(li);
    });

    // 2. Update Main Display with TOTALS
    document.getElementById('calVal').innerText = totalCals;
    document.getElementById('aiThought').innerText = items.length > 1 ? "Meal Analysis Complete" : `"${items[0].reasoning_summary}"`;

    // 3. Fuzzy Logic for the WHOLE MEAL (Aggregate)
    const mealFuzzy = calculateFuzzyHealth(totalCals, totalP, totalF, totalC);
    
    const typeEl = document.getElementById('gradeVal');
    typeEl.innerText = mealFuzzy.category; 
    typeEl.className = `text-xl font-bold uppercase tracking-wider ${mealFuzzy.colorClass}`; 
}

// ==========================================
//  FUZZY LOGIC ENGINE (Client-Side)
// ==========================================

function calculateFuzzyHealth(calories, protein, fats, carbs) {
    
    // --- 1. FUZZIFICATION ---
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

    // --- 2. RULE EVALUATION ---
    let ruleStrengths = {
        veryHealthy: 0,
        healthy: 0,
        notHealthy: 0,
        junk: 0
    };

    // RULE 1: High Protein AND Low Fat = Very Healthy (Gym food)
    const r1 = Math.min(f.protein.high, f.fats.low);
    ruleStrengths.veryHealthy = Math.max(ruleStrengths.veryHealthy, r1);

    // RULE 2: Balanced Macros = Healthy
    const r2 = Math.min(f.protein.med, f.carbs.med, f.fats.med);
    ruleStrengths.healthy = Math.max(ruleStrengths.healthy, r2);

    // RULE 3: Low Calories AND High Protein = Very Healthy
    const r3 = Math.min(f.calories.low, f.protein.high);
    ruleStrengths.veryHealthy = Math.max(ruleStrengths.veryHealthy, r3);

    // RULE 4: High Fats AND High Carbs = Junk Food
    const r4 = Math.min(f.fats.high, f.carbs.high);
    ruleStrengths.junk = Math.max(ruleStrengths.junk, r4);

    // RULE 5: High Calories AND Low Protein = Not Healthy
    const r5 = Math.min(f.calories.high, f.protein.low);
    ruleStrengths.notHealthy = Math.max(ruleStrengths.notHealthy, r5);

    // RULE 6: High Sugar (Carbs) AND Low Protein = Junk
    const r6 = Math.min(f.carbs.high, f.protein.low);
    ruleStrengths.junk = Math.max(ruleStrengths.junk, r6);

    // --- NEW RULES FOR SNACKS (Fix for Milk) ---

    // RULE 7: Low Calories AND (Low or Med Fat) AND (Low or Med Carbs) = Healthy 
    // Captures Milk, small sandwiches, etc.
    const r7 = Math.min(
        f.calories.low, 
        Math.max(f.fats.low, f.fats.med), 
        Math.max(f.carbs.low, f.carbs.med)
    );
    ruleStrengths.healthy = Math.max(ruleStrengths.healthy, r7);

    // RULE 8: Low Calories AND Med Protein = Very Healthy
    // Captures Greek Yogurt, Milk, Protein shakes
    const r8 = Math.min(f.calories.low, f.protein.med);
    ruleStrengths.veryHealthy = Math.max(ruleStrengths.veryHealthy, r8);


    // Default Rule: Small fallback
    ruleStrengths.notHealthy = Math.max(ruleStrengths.notHealthy, 0.1); 

    // --- 3. AGGREGATION & DEFUZZIFICATION ---
    const numerator = (ruleStrengths.veryHealthy * 100) + 
                      (ruleStrengths.healthy * 75) + 
                      (ruleStrengths.notHealthy * 40) + 
                      (ruleStrengths.junk * 10);
                      
    const denominator = ruleStrengths.veryHealthy + 
                        ruleStrengths.healthy + 
                        ruleStrengths.notHealthy + 
                        ruleStrengths.junk;

    // Prevent division by zero
    const healthScore = denominator === 0 ? 50 : numerator / denominator;

    // --- 4. MAP SCORE TO CATEGORY ---
    if (healthScore >= 80) return { category: "Very Healthy", colorClass: "text-emerald-400", colorName: "emerald" };
    if (healthScore >= 60) return { category: "Healthy", colorClass: "text-green-400", colorName: "green" };
    if (healthScore >= 30) return { category: "Not Healthy", colorClass: "text-orange-400", colorName: "orange" };
    return { category: "Junk Food", colorClass: "text-red-500", colorName: "red" };
}