---
name: time-awareness
description: Central Time awareness and date computation for the home assistant platform — PowerShell CT time, relative date resolution, quiet hours, and time-based decision making. Use when user says "what time", "compute time", "quiet hours", "time awareness", "date calculation", "leave by time", "current time", or any time-sensitive operation.
---

# Time Awareness Skill

Canonical patterns for time computation, date resolution, and time-based decisions across all agents in the home assistant platform.

## Why This Exists

The platform runs on Central Time (or your configured timezone). Agents MUST compute time fresh every run — never trust cached or passed-in time values. This skill provides the single source of truth for how time is handled.

## Rule 1: ALWAYS Compute Fresh (NEVER Trust Passed-In Time)

**CRITICAL:** Never trust `current_datetime` headers, dispatch messages, or any time value passed between agents. The `current_datetime` header is UTC (ends with `Z`) — using it as Central Time causes 5-hour errors.

### Get Current Time

```powershell
[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Central Standard Time').ToString('dddd, MMMM d, yyyy h:mm tt')
```

This is the ONLY source of truth for current local time.

### Get Current Date Only

```powershell
[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Central Standard Time').ToString('yyyy-MM-dd')
```

## Rule 2: Resolve Relative Days with Math (NEVER Guess)

When anyone says "Friday", "next Monday", "this weekend" — compute the exact date:

```powershell
$today = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Central Standard Time')
$targetDay = [System.DayOfWeek]::Friday
$daysUntil = (([int]$targetDay - [int]$today.DayOfWeek + 7) % 7)
if ($daysUntil -eq 0) { $daysUntil = 7 }  # "Friday" when today IS Friday = next Friday
$targetDate = $today.AddDays($daysUntil)
Write-Output "$($targetDate.ToString('dddd, MMMM d, yyyy'))"
```

**Always state the result explicitly:** "Today is Wednesday, May 6. This Friday = Friday, May 8. ✅"

## Rule 3: Quiet Hours Enforcement

| Period | Rule |
|--------|------|
| 10 PM – 6 AM CT (weekdays) | No non-urgent notifications |
| 10 PM – 8 AM CT (weekends) | No non-urgent notifications |
| Exception | If user messages first, respond normally |
| Exception | Urgent/safety alerts bypass quiet hours |

### Check If Quiet Hours

```powershell
$now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Central Standard Time')
$hour = $now.Hour
$isWeekend = $now.DayOfWeek -eq 'Saturday' -or $now.DayOfWeek -eq 'Sunday'
$quietStart = 22  # 10 PM
$quietEnd = if ($isWeekend) { 8 } else { 6 }
$isQuiet = ($hour -ge $quietStart) -or ($hour -lt $quietEnd)
Write-Output "Quiet hours: $isQuiet (Current: $($now.ToString('h:mm tt')))"
```

## Rule 4: Energy Matching (for task-coach and similar)

| Time Block | Best For |
|-----------|----------|
| 6 AM – 11 AM | Complex/creative/hard tasks |
| 11 AM – 2 PM | Moderate tasks, errands, digital work |
| 2 PM – 5 PM | Routine/easy tasks |
| After 5 PM | Quick wins, closing tasks, prep-for-tomorrow |

## Rule 5: Work Hours Detection

```powershell
$now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Central Standard Time')
$isWorkday = $now.DayOfWeek -notin @('Saturday', 'Sunday')
$isWorkHours = $isWorkday -and ($now.Hour -ge 9) -and ($now.Hour -lt 17)
Write-Output "Work hours: $isWorkHours"
```

During work hours (9 AM – 5 PM weekdays), suppress chore nudges unless there are gaps between meetings.

## Rule 6: Leave-By Time Calculation

For any appointment/activity with a known location:

1. Use `get_drive_time(origin, destination)` to calculate travel time
2. Add 15-minute buffer (parking, walking, check-in)
3. Subtract from event start time = leave-by time
4. Create task with priority=high

```
Leave-by = Event Start - Drive Time - 15 min buffer
```

**IMPORTANT:** You MUST know the starting location. If unknown, create a clarification task instead of guessing.

## Rule 7: Stale Time Guards

- Before surfacing time-sensitive items (calls, leave-by reminders, "starting now" tasks), verify against `gcal_today` / `gcal_upcoming`
- Do NOT carry over prior-day time-locks from agent working memory
- If a time-sensitive item is stale → remove from active context before sending nudges

## Anti-Patterns (NEVER Do These)

- ❌ Assume dates without computing them via PowerShell
- ❌ Use UTC `current_datetime` header as local time
- ❌ Trust time values from dispatch messages or other agents
- ❌ Calculate leave-by time without confirmed starting location
- ❌ Carry stale time-sensitive items from yesterday's working memory
- ❌ Send non-urgent notifications during quiet hours
