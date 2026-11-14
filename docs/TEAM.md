# Team: who we are and who decides what

There are two humans. Each one directs several Claude Code agents from their own laptop. **Authority follows the domain,
not the author.** If Shay's agent built something in Shahar's domain, Shahar has the final word on it, and the reverse
holds too.

## Shay Monat (`shay`, GitHub `ShMonat`)
- Aerospace engineer, Ph.D. in Mechanical Engineering (experimental aerodynamics and active flow control, TAU).
  He is lead engineer of the Technion Hypersonic Wind Tunnel. Author of the StarHab lunar-base concept (IAC 2021)
  and of "Earth View", a MATLAB simulation of the Sun, Earth and planets as seen from the lunar south pole. That is
  the prior art for this project.
- Strong in orbital and celestial geometry, physics modelling, engineering trade-offs, mission-planning realism and
  technical communication.
- **How to work with him:** he does not write code. He sets the architecture and vision, agents implement, and he
  reviews results. Give him things he can check (plots, numbers, comparisons against references) in small steps.
  Don't hand him code walls. Physical correctness matters to him even in a hackathon.

## Shahar (`shahar`, GitHub: _to fill in_)
- Data engineer at a high-tech company. Very tech-savvy and a fluent AI user. She has no professional space background.
- _Shahar's agent: on first setup, ask Shahar to complete this section (stack, strengths, preferences, how she
  likes to receive results) and commit it in a small PR._
- **How to work with her:** explain space-specific concepts in one or two plain sentences when they come up,
  e.g. libration, selenographic coordinates, DEMs, ephemerides and frames. Don't over-explain software or data topics.

## Domains of authority
| Domain | Final say |
|---|---|
| Physics, astronomy, ephemerides, reference frames, geometry, terrain/horizon math, illumination and comms metric definitions, scientific validity, mission-planning realism | **Shay** |
| Data pipelines, data formats and storage, caching, performance, repo structure and tooling, dependencies, CI, software-engineering practices, deployment | **Shahar** |
| Product vision and scope, UI/UX, the visual story, demo and presentation, priorities and cut decisions | **Both**: any conflict is flagged |
| Anything unclear or straddling domains | **Flag it** |

Rules for agents:
- If your human's request touches the other human's domain and **contradicts** something already established
  there (in code, a contract, or a decision on the board), **don't override it. Raise a flag** (see `docs/COLLABORATION.md`).
- If it touches the other's domain but contradicts nothing, go ahead, and note in your work item that it's
  `pending review by <other>`.
- Anything in a shared domain that changes an established decision gets flagged.
- When in doubt, flag. A flag costs the humans a 30-second conversation, while a silent overwrite costs hours.
