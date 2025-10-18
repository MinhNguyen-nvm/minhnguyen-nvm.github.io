---
layout: post
title: "How Modularization Speeds Up Your Team"
date: 2018-05-04
categories: [Android, Architecture, Modularization]
tags: [android, gradle, build-optimization, team-productivity]
---

*This post is to bookmark my presentation at DroidCon Vietnam on May 4, 2018, where I shared Grab's experience migrating from a monolithic Android architecture to a modularized approach.*

Before 2017, while Android modularization was possible, many projects remained monolithic. The tooling existed, but modularization wasn't yet widely adopted across the Android development community. In 2017, Grab rewrote the Passenger app, transitioning from pure Java to Kotlin with a completely different architecture. One of the best decisions we made during this rewrite was adopting a modularized project structure.

After working on the re-architecture of the Grab Passenger project, I joined the DroidCon conference to share with the community our experience and the lessons we learned during this transformation.

📺 **Watch the full presentation**: [DroidCon Talk on YouTube](https://www.youtube.com/watch?v=I9xzmAIHMFM)
📄 **View the slides**: [SpeakerDeck Presentation](https://speakerdeck.com/roscrazy/how-modularization-speed-up-your-team)

In this presentation, you'll learn about:
1. **Monolith difficulties** - Common problems with monolithic Android projects
2. **How modularization improve your build time** - Dramatic performance improvements and the techniques behind them
3. **Enforce separate/decouple the code** - Strategies for creating truly independent modules
4. **Experience sharing** - Practical tips and lessons learned from real implementation


## The Problem: Living with a Monolith

When working with large teams on a single big project, monolithic architecture creates several challenges:

Key issues with monolithic builds:

**1. Not much incremental build benefit - every build compiles the whole project**

In a monolithic structure, even small changes trigger extensive recompilation. When you modify a single line of code in one feature, the build system can't effectively isolate that change. Due to the interconnected nature of the codebase, Gradle often needs to recompile multiple packages and dependencies, making "incremental" builds not truly incremental. This means developers wait nearly the same amount of time for small changes as they do for major refactors.

**2. Limited parallel compilation capabilities**

Monolithic projects create a sequential compilation bottleneck. Since all code lives in a single module with complex interdependencies, the build system cannot leverage modern multi-core processors effectively. Even with powerful development machines, you're essentially running a single-threaded compilation process for most of the build. This wastes valuable CPU resources and forces developers to wait unnecessarily long for builds to complete.

### Code Coupling and Conflicts
In a monolithic setup, features can easily become tightly coupled, leading to:
- Code collisions between different features
- Difficulty in maintaining clean separation
- Challenges with team collaboration

## How Modularization Improves Build Time

Modularization addresses these issues by breaking down the codebase into independent modules with proper dependency management. The key improvements come from three major areas:

### 1. Parallel Compilation
Independent modules can compile simultaneously across multiple CPU cores, dramatically improving build times. Instead of waiting for sequential compilation, your build system can utilize the full power of modern multi-core processors.

### 2. Better Incremental Builds
Modularization enables genuine incremental compilation. When you change code in one module, only that module and its direct dependents need recompilation. This is a massive improvement over monolithic builds where any change could trigger recompilation of the entire project.

### 3. Better Dependency Management (Android Gradle Plugin 3.0+)
Android Gradle Plugin 3.0 introduced improved dependency configurations:
- **`implementation`**: Hides transitive dependencies, preventing unnecessary recompilation (recommended)
- **`api`**: Exposes transitive dependencies to consumers (use sparingly)

This change allows Gradle to create a more precise dependency graph and avoid recompiling modules when their transitive dependencies change but their public API remains stable.


## Enforcing Code Separation

![Modularization Benefits Flow](/assets/images/modularization/modularization-benefits-flow.png)
*The flow of benefits from modularization: Independent modules lead to forced decoupling and interface-based design, resulting in cleaner architecture and enabling parallel team development.*

---

**Want to learn more?** Check out the [full presentation slides](https://speakerdeck.com/roscrazy/how-modularization-speed-up-your-team) or [watch the complete video](https://www.youtube.com/watch?v=I9xzmAIHMFM) for detailed explanations, performance metrics, and practical implementation tips!

---

*Presented at DroidCon Vietnam on May 4, 2018*

**Connect with me:**
- Twitter: [@MinhDev88](https://twitter.com/MinhDev88)
- LinkedIn: [minhnguyenvan](https://www.linkedin.com/in/minhnguyenvan)