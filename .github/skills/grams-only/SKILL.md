---
name: grams-only
description: All food measurements must use grams exclusively. {{PARENT_1}} uses a kitchen scale — never use tablespoons, ounces, cups, or volumetric units. Use when providing recipes, meal suggestions, ingredient quantities, or any food-related measurements.
---

# Grams-Only Measurement Skill

## Rule

**ALL food measurements must be in grams (g).** {{PARENT_1}} uses a kitchen scale exclusively and does not measure with volumetric tools.

## Forbidden Units

Never use any of the following in recipes, meal suggestions, or food quantities:

- ❌ Tablespoons (tbsp)
- ❌ Teaspoons (tsp)
- ❌ Cups
- ❌ Ounces (oz)
- ❌ Fluid ounces (fl oz)
- ❌ Pounds (lb)
- ❌ "A handful"
- ❌ "A pinch"
- ❌ Any non-gram unit

## Required Format

- ✅ `150g Greek yogurt`
- ✅ `30g almonds`
- ✅ `200g Bob Evans liquid eggs`
- ✅ `15g olive oil`
- ✅ `5g salt`

## Conversion Reference

Common conversions for quick reference:

| Food | Common unit | Grams equivalent |
|------|-------------|-----------------|
| Butter | 1 tbsp | 14g |
| Olive oil | 1 tbsp | 13g |
| Peanut butter | 2 tbsp | 32g |
| Greek yogurt | 1 cup | 245g |
| Almonds | 1 oz | 28g |
| Liquid eggs | 3 tbsp (1 serving) | 46g |
| Rice (dry) | 1 cup | 185g |
| Chicken breast | 1 medium | 170g |
| Cheese (shredded) | 1/4 cup | 28g |

## When This Applies

- Recipes (saved via `add_recipe`)
- Meal suggestions from fitness-coach
- Grocery quantities when specific
- Any food-related Telegram message to {{PARENT_1}}
- Meal plan descriptions

## Who This Affects

All agents that discuss food with {{PARENT_1}}:
- `fitness-coach`
- `nutrition-chef`
- `meal-planner`
- `daily-briefing` (if mentioning meals)
- Any agent using `add_recipe` or `set_meal`
