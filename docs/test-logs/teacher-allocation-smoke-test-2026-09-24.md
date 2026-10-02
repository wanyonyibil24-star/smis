# Teacher Allocation → Master Timetable Smoke Test

**Date:** 24 September 2026  
**System:** NEXUS-SMIS  
**Scope:** Grade 7, Grade 8, and Grade 9 allocation flow into the automatic master timetable

## Test method

The smoke test used the application service layer rather than direct SQL inserts. A temporary academic year (`2099`) and term (`Smoke Test`) were used to isolate the verification from live school records. The test created a temporary Grade 9 fixture because the live grade catalog contained Grade 7 and Grade 8 but did not yet contain Grade 9.

The same active teacher, Erickology, was allocated English (`ENG`) for each grade. The automatic timetable generator was then run for five days and eight periods per day.

## Results

| Grade | Teacher | Learning area | Day | Period | Outcome |
|---|---|---|---:|---:|---|
| Grade 7 | Erickology | English (`ENG`) | 2 | 5 | Placed successfully |
| Grade 8 | Erickology | English (`ENG`) | 2 | 6 | Placed successfully |
| Grade 9 | Erickology | English (`ENG`) | 2 | 7 | Placed successfully |

The generator reported **3 lessons placed**, **0 unplaced requirements**, and no teacher or grade timetable clash. Each grade received a distinct slot, confirming that active teacher allocations were read by the automatic timetable generator and carried through to timetable entries.

## Cleanup verification

All temporary records were removed after the assertions completed. A post-test read-only check confirmed that the temporary `2099 / Smoke Test` allocation count was **0**. The temporary Grade 9 fixture, timetable requirements, timetable entries, allocations, and generated audit records were not retained.

## Conclusion

The authoritative allocation-to-timetable path passed for Grades 7–9. The system correctly accepted the allocation context, generated non-conflicting master-timetable placements, and preserved the existing school data after cleanup.
