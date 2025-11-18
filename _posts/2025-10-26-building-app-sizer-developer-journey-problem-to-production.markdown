---
layout: single
classes: wide
title: "Building App Sizer: A Developer's Journey from Problem to Production Tool"
date: 2025-10-26 10:00:00 +0800
categories: [Engineering, Android]
tags: [app-size, android, open-source, developer-tools, apk-analysis, grab, project-bonsai]
excerpt: "How I turned a team frustration into an open-source Android app size analysis tool"
author_profile: false
read_time: true
comments: true
share: true
related: true
toc: false
sidebar:
  nav: "posts"
---

*How I turned a team frustration into an open-source Android app size analysis tool*

---

## Introduction

In my [other blog post](https://minhnguyen-nvm.github.io/engineering/android/android-app-size-at-scale-with-project-bonsai/), I shared how our team at Grab tackled Android app size optimization at scale, achieving a 26% reduction in our app download size. The centerpiece of that journey was **[App Sizer](https://github.com/grab/app-sizer)** - an open-source tool that provides detailed insights into APK composition and helps developers identify size reduction opportunities.

**App Sizer is now open source and available on GitHub: [github.com/grab/app-sizer](https://github.com/grab/app-sizer)**

But how exactly did I build this tool? What technical challenges did I face, and what design decisions shaped the final product? In this post, I'll take you through my engineering journey - from the initial naive attempts to the production-ready, open-source tool that teams across the industry now use.

## The Problem That Started It All

As I detailed in my [previous blog post about app size optimization at scale](https://minhnguyen-nvm.github.io/engineering/android/android-app-size-at-scale-with-project-bonsai/), I faced a critical challenge while working with our team at Grab: understanding what was driving our Android app's growing size. While existing tools like Android Studio's APK Analyzer provided basic insights, they couldn't answer the fundamental questions I needed for effective optimization:

- **Detailed size breakdown** - How much comes from our codebase vs libraries?
- **Size contribution by teams** - Which teams should prioritize optimization?
- **Module-wise size contribution** - Which modules are the biggest contributors?
- **Size contribution by libraries** - Are external dependencies driving our size?
- **List of large files** - What specific files should we investigate?

In 2021, **no tool in the Android community** could provide this level of attribution. This blog post focuses on the technical journey of building [App Sizer](https://github.com/grab/app-sizer) to fill that gap.

With the problem clearly defined and no existing solutions available, I set out to build the tool myself. This is the story of that technical journey.

## The Discovery Journey

The core insight came to me early: **if I could parse both the APK contents and the source artifacts (AAR/JAR files), I could map them together to determine what contributes to the final app size**.

The general idea was straightforward:
1. **Parse AAR & JAR files** from modules and libraries to understand what classes and resources they contain
2. **Parse APK files** to extract all classes and files with their actual download sizes
3. **Map them together** - connect APK components back to their source modules
4. **Calculate size distribution** - attribute each byte in the APK to its origin

Parsing AAR and JAR files seemed simple enough - they're just ZIP archives, straightforward to extract and analyze. The real challenge would be on the APK side.

In practice, it turned out to be significantly more complex than expected.

### First Attempt: "How Hard Can APK Parsing Be?"

Like many developers, I started with overconfidence. "APK files are just ZIP archives, right? I'll just parse them myself!"


This approach quickly revealed its challenges:
- **DEX files** required special handling for class-level analysis
- **R8/ProGuard mapping** added another layer of complexity

The biggest challenge was **parsing DEX files to extract class-level details**. DEX (Dalvik Executable) files have a complex binary format that requires deep understanding of:

```
DEX File Structure:
┌─────────────────┐
│ Header          │ ← Magic numbers, checksums, offsets
├─────────────────┤
│ String IDs      │ ← String table references
├─────────────────┤
│ Type IDs        │ ← Type descriptors
├─────────────────┤
│ Proto IDs       │ ← Method prototypes
├─────────────────┤
│ Field IDs       │ ← Field references
├─────────────────┤
│ Method IDs      │ ← Method references
├─────────────────┤
│ Class Defs      │ ← Class definitions (what I needed!)
├─────────────────┤
│ Data Section    │ ← Actual bytecode and data
└─────────────────┘
```

Each class definition contains size information buried deep in the binary format. Worse yet, when R8/ProGuard is enabled, class names are obfuscated, requiring parsing of mapping files to restore original names:

```
# R8 mapping file format
com.example.MyClass -> a.b.c:
    void methodName() -> a
    int fieldName -> b
```

After hours of wrestling with binary offsets, string tables, and mapping file parsing, I realized I was reinventing a very complex wheel.

### Standing on Giants' Shoulders

Then it hit me: **Android Studio already does this perfectly**.

The [APK Analyzer](https://developer.android.com/studio/debug/apk-analyzer) in Android Studio provides exactly the breakdown we needed:
- Raw file sizes vs. download sizes
- Class-level analysis
- R8 mapping support

And the best part? **Android Studio is open source**

Instead of building parsing logic from scratch, I could leverage Google's battle-tested implementation. Diving into the Android tooling source code, I found the exact components I needed:

- **DEX parsing**: [`DexBackedClassDef`](https://javadoc.io/doc/org.smali/dexlib2/2.0.5/org/jf/dexlib2/dexbacked/DexBackedClassDef.html) and [`DexBackedDexFile`](https://javadoc.io/doc/org.smali/dexlib2/2.3.4/org/jf/dexlib2/dexbacked/DexBackedDexFile.html) from the `org.smali:dexlib2` library for extracting class information from DEX files
- **Size calculation**: [`ApkSizeCalculator`](https://android.googlesource.com/platform/tools/base/+/studio-master-dev/apkparser/analyzer/src/main/java/com/android/tools/apk/analyzer/ApkSizeCalculator.java) and [`GzipSizeCalculator`](https://android.googlesource.com/platform/tools/base/+/studio-master-dev/apkparser/analyzer/src/main/java/com/android/tools/apk/analyzer/internal/GzipSizeCalculator.java) for calculating both raw and download sizes
- **Deobfuscation**: `shadow.bundletool.com.android.tools.proguard.ProguardMap` for handling R8/ProGuard mapping files

With these proven components, I could focus on the unique value proposition: **the mapping logic**.

With the right components identified and a clear architectural vision, it was time to translate this concept into working code. Here's how I structured the implementation.

## Implementation Deep Dive

### The Architecture Emerges

The insight was to create a **mapping tool** that connects APK components to their source modules:

```
APK Components + Module/library Binaries + Project Metadata = Detailed Size Attribution
```

I structured the core engine around three main stages, each with clear responsibilities:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   INPUT FILES   │    │     PARSING     │    │   STRUCTURED    │
│                 │    │    (Stage 1)    │    │      DATA       │
│ • APK files     │───▶│                 │───▶│                 │
│ • AAR files     │    │ • ApkParser     │    │ • ApkFileInfo   │
│ • JAR files     │    │ • AarParser     │    │ • AarFileInfo   │
│ • Mapping files │    │ • JarParser     │    │ • JarFileInfo   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     REPORTS     │    │    ANALYSIS     │    │     MAPPING     │
│                 │    │    (Stage 3)    │    │    (Stage 2)    │
│ • Team sizes    │◀───│                 │◀───│                 │
│ • Module sizes  │    │ • ApkAnalyzer   │    │ • ClassMapper   │
│ • Library sizes │    │ • ModuleAnalyzer│    │ • ResourceMapper│
│ • Large files   │    │ • LibAnalyzer   │    │ • AssetMapper   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

#### Stage 1: Parsing (`parser/` package)
The first stage extracts structured data from all input files. Each file type has its own specialized parser that understands the specific format and extracts relevant information:

```kotlin
// Each file type has its own specialized parser interface
interface ApkFileParser {
    fun parseApks(apks: Sequence<File>, proguardMap: ProguardMap): Set<ApkFileInfo>
}

interface AarFileParser {
    fun parseAars(files: Sequence<SizerInputFile>): Set<AarFileInfo>
}

interface JarFileParser {
    fun parseJars(files: Sequence<SizerInputFile>): Set<JarFileInfo>
}
```

*View the implementations: [`ApkFileParser`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/parser/ApkFileParser.kt), [`AarFileParser`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/parser/AarFileParser.kt), [`JarFileParser`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/parser/JarFileParser.kt)*

Each parser extracts different information based on the file format:

- **ApkFileParser**: Uses `ApkSizeCalculator` to extract classes (via DEX parsing), resources, assets, and native libraries with both raw and download sizes. Handles ProGuard deobfuscation.
- **AarFileParser**: Parses AAR files (Android libraries) to extract resources, assets, native libs, and embedded JAR files. Since AARs are ZIP files, this is relatively straightforward.
- **JarFileParser**: Extracts classes and native libraries from JAR files. Like AAR parsing, leverages standard ZIP file handling.

The APK parsing is the most complex, leveraging the Android tooling components I mentioned earlier to handle DEX files and size calculations accurately.

#### Stage 2: Mapping (`analyzer/mapper/` package)
The second stage connects APK components back to their source modules:

```kotlin
interface ComponentMapper {
    fun Set<ApkFileInfo>.mapTo(
        aars: Set<AarFileInfo>, 
        jars: Set<JarFileInfo>
    ): ComponentMapperResult
}
```

*View the interface: [`ComponentMapper`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/mapper/ComponentMapper.kt)*

I implemented specialized mappers for each component type, each handling unique challenges:

**[`ClassComponentMapper`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/mapper/ClassComponentMapper.kt)**: The most complex mapper
- Maps Java/Kotlin classes from APK DEX files to their source AAR/JAR files
- Deals with auto-generated lambda classes (`-$$Lambda$`)
- Manages synthetic classes created by the compiler

**[`ResourceComponentMapper`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/mapper/ResourceComponentMapper.kt)**: Handles Android resources
- Maps resources with version-specific directories (`drawable-v22/`)
- Handles special characters in resource names (`$bg_network_error__0.xml`)
- Accounts for renamed resources during the build process

**[`AssetComponentMapper`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/mapper/AssetComponentMapper.kt)**: Straightforward asset mapping
- Direct path matching between APK assets and AAR assets

**[`NativeLibComponentMapper`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/mapper/NativeLibComponentMapper.kt)**: Handles native libraries
- Normalizes path differences between APK (`/lib/armeabi-v7a/`) and AAR (`/jni/armeabi-v7a/`)
- Maps .so files to their source modules

Each mapper returns unmatched components as "no owner" data, **which gets attributed to the app module as a fallback.**

#### Stage 3: Analysis (`analyzer/` package)
The final stage transforms mapped data into actionable reports. Each analyzer focuses on a specific aspect of the size analysis:

```kotlin
interface Analyzer {
    fun process(): Report
}
```

*View the interface: [`Analyzer`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/Analyzer.kt)*

I implemented several specialized analyzers to answer different questions:

**[`ApkAnalyzer`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/ApkAnalyzer.kt)**: Provides the high-level breakdown
- Separates codebase vs library contributions
- Breaks down by component type: `codebase-kotlin-java`, `codebase-resources`, `codebase-assets`, `android-java-libraries`, `native-libraries`
- Calculates the "Others" category for unmatched components

**[`ModuleAnalyzer`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/ModuleAnalyzer.kt)**: Shows module-wise contributions
- Maps contributors to project modules
- Integrates team ownership information
- Handles the special "app" module for unmatched components

**[`LibrariesAnalyzer`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/LibrariesAnalyzer.kt)**: Focuses on external dependencies
- Analyzes third-party library contributions
- Helps identify heavy dependencies that could be optimized

**[`LargeFileAnalyzer`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/LargeFileAnalyzer.kt)**: Identifies optimization opportunities
- Finds files above a configured size threshold
- Useful for discovering unexpectedly large assets or resources

**[`LibContentAnalyzer`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/analyzer/LibContentAnalyzer.kt)**: Deep-dive into specific libraries
- Shows what's inside a particular library dependency
- Helpful for understanding why a library is taking up space

**The beauty of this analyzer pattern is extensibility** - adding new report types requires only implementing the `Analyzer` interface, without touching the core parsing or mapping logic.

The three-stage architecture solved the core technical challenges, but I also needed to think about how developers would actually use this tool in practice.

### Building for the Future: CLI First, Plugin Ready

When I started building [App Sizer](https://github.com/grab/app-sizer), **time was limited** on the [Bonsai project](https://minhnguyen-nvm.github.io/engineering/android/android-app-size-at-scale-with-project-bonsai/). I needed a working solution quickly, so I focused on a **CLI tool first**. But I had a vision: eventually, this should be available as a **Gradle plugin** for seamless Android project integration.

This vision shaped my architectural decisions right at the beginning. Instead of building a monolithic CLI tool, I designed the core engine with abstraction in mind, knowing I'd need to support different interfaces later:

- **Immediate need**: CLI for our immediate use
- **Future vision**: Gradle plugin for the broader Android community

The challenge was building the right abstractions **without over-engineering**. I needed something that worked now but could evolve later.

### Clean Separation of Concerns

I solved this by designing the core analysis engine (`app-sizer` module) to be completely **interface-agnostic**. The core logic only knows about two contracts:

```kotlin
// Core interfaces that abstract away the client details
interface InputProvider {
    fun provideModuleAar(): Sequence<SizerInputFile>
    fun provideModuleJar(): Sequence<SizerInputFile>
    fun provideLibraryJar(): Sequence<SizerInputFile>
    fun provideLibraryAar(): Sequence<SizerInputFile>
    fun provideApkFiles(): Sequence<File>
    fun provideR8MappingFile(): File?
    fun provideTeamMappingFile(): File?
    fun provideLargeFileThreshold(): Long
}

interface OutputProvider {
    fun provideInfluxDbConfig(): InfluxDBConfig?
    fun provideOutPutDirectory(): File
    fun provideProjectInfo(): ProjectInfo
    fun provideCustomProperties(): CustomProperties
}
```

*View the actual interfaces: [`InputProvider`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/utils/InputProvider.kt) and [`OutputProvider`](https://github.com/grab/app-sizer/blob/master/app-sizer/src/main/kotlin/com/grab/sizer/utils/OutputProvider.kt)*

The beauty of this design is that **the core engine doesn't care** whether the inputs come from:
- YAML configuration files (CLI)
- Gradle project introspection (Plugin)
- Environment variables, databases, or any future interface

### Implementation in Practice

Here's how each interface implements these contracts:

**CLI Implementation:**
```kotlin
class AnalyzerCommand : CliktCommand() {
    override fun run() {
        val config = ConfigYmlLoader().load(settingFile)
        
        DefaultApkGenerator.create(config)
            .generate(config.apkGeneration.deviceSpecs)
            .forEach { apkDirectory ->
                AppSizer(
                    inputProvider = CliInputProvider(
                        fileQuery = DefaultFileQuery(),
                        config = config,
                        apksDirectory = apkDirectory
                    ),
                    outputProvider = CliOutputProvider(config, apkDirectory.nameWithoutExtension),
                    libName = libName,
                    logger = CliLogger()
                ).process(reportOption)
            }
    }
}
```

*View the CLI implementation: [`AnalyzerCommand`](https://github.com/grab/app-sizer/blob/master/cli/src/main/kotlin/com/grab/sizer/AnalyzerCommand.kt), [`CliInputProvider`](https://github.com/grab/app-sizer/blob/master/cli/src/main/kotlin/com/grab/sizer/CliInputProvider.kt), [`CliOutputProvider`](https://github.com/grab/app-sizer/blob/master/cli/src/main/kotlin/com/grab/sizer/CliOutputProvider.kt)*

The CLI loads YAML configuration and creates providers that handle file system scanning and directory-based artifact discovery.

**Gradle Plugin Implementation:**
```kotlin
@TaskAction
fun run() {
    apkDirectories.forEach { apkDirectory ->
        val projectInfo = ProjectInfo(
            projectName = project.rootProject.name,
            versionName = variantInput.get().versionName ?: "NA",
            deviceName = apkDirectory.nameWithoutExtension,
            buildType = variantInput.get().name
        )
        val archiveDependencyStore = ArchiveDependencyManager()
            .readFromJsonFile(archiveDepJsonFile.asFile.get())
            
        AppSizer(
            inputProvider = PluginInputProvider(
                archiveDependencyStore = archiveDependencyStore,
                r8MappingFile = r8MappingFile.orNull?.asFile,
                apksDirectory = apkDirectory,
                largeFileThreshold = largeFileThreshold.get(),
                teamMappingFile = teamMappingFile.orNull?.asFile
            ),
            outputProvider = PluginOutputProvider(
                influxDBConfig = influxDBConfig.orNull,
                projectInfo = projectInfo,
                customProperties = customProperties.get(),
                outputFolder = outputDirectory.asFile.get()
            ),
            libName = libName.orNull,
            logger = PluginLogger(project)
        ).process(option.get())
    }
}
```

*View the Gradle plugin implementation: [`AppSizeAnalysisTask`](https://github.com/grab/app-sizer/blob/master/sizer-gradle-plugin/src/main/kotlin/com/grab/plugin/sizer/tasks/AppSizeAnalysisTask.kt), [`PluginInputProvider`](https://github.com/grab/app-sizer/blob/master/sizer-gradle-plugin/src/main/kotlin/com/grab/plugin/sizer/utils/PluginInputProvider.kt), [`PluginOutputProvider`](https://github.com/grab/app-sizer/blob/master/sizer-gradle-plugin/src/main/kotlin/com/grab/plugin/sizer/utils/PluginOutputProvider.kt)*

The Gradle plugin automatically discovers dependencies through Gradle's APIs and creates providers that leverage the project's existing build configuration.

### The Payoff: Smooth Evolution

This forward-thinking architecture paid off when I later built the Gradle plugin. Instead of rewriting the core logic, I only needed to:

1. **Create new provider implementations** that worked with Gradle's project model
2. **Design a native Gradle DSL** for configuration
3. **Integrate with Gradle's task system** for proper dependency management

The core analysis engine remained unchanged - exactly as planned.

### Benefits of This Architecture

1. **Avoid Code Duplication**: All parsing, mapping, and analysis logic exists once in the core module
2. **Easy Testing**: Core logic can be tested independently of interface concerns
3. **Future-Proof**: Adding new interfaces (Maven plugin, IDE extension, etc.) requires no changes to the core engine

## Areas for Improvement

While App Sizer has proven valuable in production, there are several areas where it could be enhanced:

**Performance Optimization**: Currently, multiple parts of the process can run in parallel, such as parsing independent files or running different types of analysis concurrently. But this hasn't been implemented yet.

**Known Limitations**: Like any tool, App Sizer has constraints and edge cases. We maintain a comprehensive list of [known limitations](https://github.com/grab/app-sizer/blob/master/LIMITATIONS.md) in our documentation, covering scenarios where the analysis might not be entirely accurate or complete.

**Build System Integration**: While our Gradle plugin works well, it doesn't yet support [Gradle's configuration cache](https://docs.gradle.org/current/userguide/configuration_cache.html), which can significantly speed up build times. Adding this support would make App Sizer more seamless in modern Android build pipelines.

These improvements represent natural evolution points for the tool, and contributions in these areas would be particularly welcome from the community.


## Conclusion

Building [App Sizer](https://github.com/grab/app-sizer) taught me that sometimes the best engineering solutions come from **smart composition rather than starting from scratch**. By leveraging Android Studio's battle-tested parsing logic and focusing on the unique challenge of attribution mapping, I was able to create a tool that provides insights no other solution offered in 2021.

### Real-World Impact
Three mobile projects in my company have adopted App Sizer. Two via the CLI and one via the Gradle plugin. This validates the interface abstraction strategy: the same core engine serves different workflows through flexible integration options.

Since open-sourcing the project last year, the response has been encouraging. With **~200 stars on GitHub** and growing adoption across the Android community, I hope [App Sizer](https://github.com/grab/app-sizer) is helping teams beyond Grab optimize their app sizes and understand their build composition.

If you're facing similar challenges with Android app size analysis, I encourage you to try [App Sizer](https://github.com/grab/app-sizer). Whether you need the CLI for custom build systems or the Gradle plugin for seamless Android integration, the tool is ready to help you understand exactly what's contributing to your app's size.

The project is open source and welcomes contributions. After all, the best developer tools are built by the community, for the community.

---

*This blog post was written with the assistance of [Claude Code](https://claude.ai/code) to speed up the writing process.*
