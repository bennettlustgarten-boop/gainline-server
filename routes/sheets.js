const express = require("express");
const router = express.Router();
const { addSheet, getSheets, getCoachIdForClient } = require("../db");
const { uid } = require("../lib/uid");
const { gramsFromAmount } = require("../lib/units");
const { requireVerified, requireRole } = require("../middleware/auth");

function macrosFor(per100, grams) {
  const factor = (Number(grams) || 0) / 100;
  return {
    cal: Math.round((per100.cal || 0) * factor),
    p: Math.round((per100.p || 0) * factor * 10) / 10,
    c: Math.round((per100.c || 0) * factor * 10) / 10,
    f: Math.round((per100.f || 0) * factor * 10) / 10,
  };
}
function sumMacros(list) {
  return list.reduce((a, m) => ({ cal: a.cal + m.cal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { cal: 0, p: 0, c: 0, f: 0 });
}

const WORKOUT_COLUMNS = ["sets", "reps", "weight", "rest", "notes"];
function sanitizeColumns(columns) {
  const out = {};
  for (const key of WORKOUT_COLUMNS) out[key] = columns?.[key] !== false; // default to shown
  return out;
}

router.post("/", requireRole("coach"), (req, res) => {
  const { clientId, type, title, days, meals, supplements, columns } = req.body;
  if (!clientId || !title?.trim()) return res.status(400).json({ error: "clientId and title are required" });
  if (getCoachIdForClient(clientId) !== req.user.id) return res.status(403).json({ error: "Not your client" });

  if (type === "workout") {
    const validDays = (days || [])
      .map((d) => ({ ...d, id: d.id || uid("day_"), exercises: (d.exercises || []).filter((e) => e.name?.trim()) }))
      .filter((d) => d.exercises.length > 0);
    if (validDays.length === 0) return res.status(400).json({ error: "Add at least one exercise" });
    const sheet = {
      id: uid("sheet_"),
      type,
      title: title.trim(),
      days: validDays,
      columns: sanitizeColumns(columns), // which exercise-row fields this sheet uses (sets/reps/weight/rest/notes)
      supplements: (supplements || "").trim(),
      createdAt: Date.now(),
    };
    return res.json({ sheets: addSheet(clientId, sheet) });
  }

  if (type === "diet") {
    const validMeals = (meals || [])
      .map((m) => ({ ...m, foods: (m.foods || []).filter((f) => f.name && Number(f.amount) > 0) }))
      .filter((m) => m.foods.length > 0);
    if (validMeals.length === 0) return res.status(400).json({ error: "Add at least one food" });
    // Bake the macro math server-side so the numbers shown to the coach and
    // the client always match what was actually sent. Amounts can be logged
    // in any weight unit (g/oz/lb/kg) but are converted to grams first since
    // the food database's macros are per 100g.
    const bakedMeals = validMeals.map((m) => {
      const foods = m.foods.map((f) => {
        const unit = f.unit || "g";
        const grams = gramsFromAmount(f.amount, unit);
        return { id: f.id || uid("food_"), name: f.name, amount: Number(f.amount), unit, grams: Math.round(grams), ...macrosFor(f.per100 || {}, grams) };
      });
      return { id: m.id || uid("meal_"), name: (m.name || "Meal").trim() || "Meal", foods, totals: sumMacros(foods) };
    });
    const sheet = {
      id: uid("sheet_"),
      type,
      title: title.trim(),
      meals: bakedMeals,
      totals: sumMacros(bakedMeals.map((m) => m.totals)),
      supplements: (supplements || "").trim(),
      createdAt: Date.now(),
    };
    return res.json({ sheets: addSheet(clientId, sheet) });
  }

  res.status(400).json({ error: "type must be workout or diet" });
});

router.get("/:clientId", requireVerified, (req, res) => {
  const { clientId } = req.params;
  const isSelf = req.user.id === clientId;
  const isTheirCoach = req.user.role === "coach" && getCoachIdForClient(clientId) === req.user.id;
  if (!isSelf && !isTheirCoach) return res.status(403).json({ error: "Not allowed" });
  res.json({ sheets: getSheets(clientId) });
});

module.exports = router;
