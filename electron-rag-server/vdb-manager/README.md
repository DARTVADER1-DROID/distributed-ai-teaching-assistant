# VDB Manager

The VDB manager exposes course-level operations. Each operation has its own
file so its storage behavior can be implemented and tested independently.

## Course contract

- `course_id` is the unique course identifier.
- `material` contains the complete `ExtractionResult` produced by the
  extraction pipeline.
- Creating an existing `course_id` must fail with
  `CourseAlreadyExistsError`; create must never overwrite.
- Updating a course replaces its entire extracted material. It is not a
  partial update or merge.

## Operations

| Operation | File | Contract |
| --- | --- | --- |
| Create course | `create-course.ts` | Create only if the ID does not exist; otherwise throw a duplicate error. |
| Update course | `update-course.ts` | Replace all extracted material for the given ID. |
| Delete course | `delete-course.ts` | Delete one course by ID. |
| Retrieve course | `get-course.ts` | Return one course by ID, or null when absent. |
| Show all courses | `get-all-courses.ts` | Return all stored courses. |
| Delete all courses | `delete-all-courses.ts` | Remove all stored courses. |

All operation bodies currently throw a not-implemented error. No vector
database provider, persistence format, or storage behavior has been selected.
