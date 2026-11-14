# Submission: rules, deliverables and checklist

Source: the Tel Aviv organizers' guide, `docs/מצגת יצירת והגשת פרויקט באתר nasa space apps.pdf` (Hebrew, 17 slides).
This file is the English working summary. Agents: these rules are **hard constraints**.

## Team decisions (2026-11-08)
- **Editor of the project page: Shay** (team lead). Shahar sends him texts. No concurrent edits.
- **Demo format: a ≤30 s video** (preferred; may change to ≤7 slides).
- **Repo goes public** once there is something to show.
- **AI use:** all through Claude Code, logged in docs/AI_USE.md.
- **Data:** if the challenge Resources (published Fri) don't include LOLA or ephemerides, we add a listed dataset in a meaningful way.
- **There are two separate judgings:** the live local presentation on Sunday 17:45 (5 min + 2 min Q&A) and the NASA submission. See PLAN.md §4.
  Two Google-form checkpoints on Sunday: by 13:00 (status, blockers, mentor wish) and by 16:00 (a short solution summary).

## Dates (Israel time)
- **Submission opens Sat 2026-11-14 09:00.** The Project tab only appears then. Draft the texts in this repo beforehand.
- **Submission closes Sun 2026-11-15 23:59.** No extensions. Saving or editing after that doesn't count.
- **Challenge Resources (NASA datasets) are published Fri 2026-11-13.** Review them that evening (see "Data eligibility").

## The project page: fields to fill
| Field | Content | Our source |
|---|---|---|
| High-Level Summary | name + short summary: what we built, how it answers the challenge, why it matters | `submission/summary.md` |
| Project Demo | **ONE link**: a video ≤ 30 s **or** slides ≤ 7 (+ title slide). **Exceeding the limit = not eligible for global judging** | demo asset |
| Final Project | link to the final project | public app URL (and/or the public repo) |
| Project Details | what it does, how it works, tools used | VISION + ARCHITECTURE, condensed |
| Use of AI | whether and how AI tools were used | `docs/AI_USE.md` |
| Space Agency Data | the NASA (and partner agency) data used and how it inspired us | data list, `docs/REFERENCES.md` |
| References | **every** code, text, image and dataset used, even free ones | `docs/REFERENCES.md` |

## Hard rules
1. **Data eligibility:** we must use **at least one NASA dataset from the challenge's Resources tab** to be eligible for
   global prizes. Partner-agency data is allowed and encouraged. Describe what we used, how, and how it inspired us.
2. **Links must be public:** no password, no sign-up, no access request. Test them in an incognito window or from a
   logged-out friend. *If the judges can't open the link, the project can't be judged.*
   → The development repo `ShMonat/Moonat` stays private. The public repo is **`ShMonat/Moonat-Navigator`**: a clean
     snapshot of `main` without the development history (Shay's decision, 2026-11-14), refreshed with
     `uv run python scripts/publish_public.py`. GitHub Pages serves it at https://shmonat.github.io/Moonat-Navigator/.
   → The app must be deployed at a public URL with no login.
3. Uploads to the NASA site: **images only** (JPG/PNG/GIF ≤ 10 MB). Video and slides are hosted externally (YouTube,
   Google Drive, GitHub, OneDrive, Dropbox) and linked.
4. **Everything in English:** the page, links and slides. A video may be in another language but **must have English subtitles**.
5. **No image, video, voice or likeness of anyone under 18** in the demo or the project. Our "kids" audience is not to be filmed.
6. No offensive content or inappropriate language.
7. **AI use is allowed but must be disclosed:**
   - Tick the use of AI on the project page and say where and how it was used.
   - AI-generated **images or video**: a **visible watermark**.
   - AI-generated **code and data**: noted **in the text and in metadata**.
   - AI-generated content **must not include or alter the NASA logo, flags or mission insignia** (e.g. no AI-made Apollo patches).
8. All team members must be registered to the **Tel Aviv** event and **approved** (not waitlisted). Members can't be
   added after the deadline.
9. **Only the last submission is judged.** You can edit and resubmit until the deadline, and after every edit you **must click
   Submit for Judging again**. Changes aren't visible to the judges until then.

## Working with the page (humans)
- Write the texts in this repo (`docs/submission/`) and paste them in. Click **Save Progress** often.
- Turn on **Lock** before editing so the other person doesn't overwrite. Only one of you edits at a time.
- Organizer guidance: **don't wait for a finished product.** Judges know two days is short. Present the
  **blueprint and the reasoning behind decisions** even if it's incomplete. **Submitting matters.**

## The 30-second video structure (organizer template)
| t | Content |
|---|---|
| 0:00 | who we are: names, team name |
| 0:02 | which challenge, and why we chose it |
| 0:05 | project name + tagline: the problem it solves and who benefits |
| 0:10 | the idea: how it works, images or prototype, user experience, how NASA data enabled it |
| 0:20 | the future: what the solution could change, for people and the world beyond |
| 0:30 | end |

## The 7-slide alternative must include
Team name and members; the challenge; an image of the project; the user experience; how NASA and space-agency data and technology
enabled the solution; a readable template with few words per slide and strong visuals.

## Final checklist (Sunday evening, before the last Submit for Judging)
- [ ] Both members are listed on the project page, registered and approved for Tel Aviv
- [ ] All fields filled, in English
- [ ] Demo: one link; video ≤ 30 s (English subtitles if needed) **or** ≤ 7 slides + title
- [ ] Final Project link works in incognito: app URL public, repo public
- [ ] At least one NASA dataset from the Resources tab is used and named under Space Agency Data
- [ ] References complete (`docs/REFERENCES.md`)
- [ ] AI use disclosed (`docs/AI_USE.md`); AI images or video watermarked; no AI-altered NASA logos or insignia
- [ ] No minors and nothing offensive in any media
- [ ] Submit for Judging clicked **after the last edit**, with a confirmation banner seen
