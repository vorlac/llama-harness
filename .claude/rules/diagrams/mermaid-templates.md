# Mermaid Diagram Templates

> **TEMPLATE REPOSITORY:** This document is authoritative for **copy-paste ready diagram templates**. For design philosophy, color rationale, and guidelines, see [diagram-standards.md](diagram-standards.md) (STANDARDS AUTHORITY).

Copy-paste ready templates for all Mermaid diagram types with complete theme configurations.

**Related docs:**
- [diagram-standards.md](diagram-standards.md) - Design philosophy, color rationale, usage guidelines (STANDARDS AUTHORITY)

> **Note:** These templates use a warm neutral palette optimized for dark backgrounds (`#262B33`).

---

## Template Index

| Diagram Type | Section | Key Variables |
|--------------|---------|---------------|
| [Flowchart](#flow-chart-template-1-simple) | Basic + Complex | `style` statements |
| [Sequence](#sequence-diagram-template) | Interactions | `actorBkg`, `actorBorder` |
| [Class](#class-diagram-template) | Types | `classDef` + `:::` syntax |
| [ER](#entity-relationship-diagram-template) | Data models | `mainBkg`, `attributeBackground*` |
| [Gantt](#gantt-chart-template) | Timelines | `taskBkgColor`, `activeTaskBkgColor` |
| [Git Graph](#git-graph-template) | Branches | `git0`-`git7`, `gitBranchLabel*` |
| [User Journey](#user-journey-template) | UX flows | `fillType0`-`fillType7` |
| [Pie](#pie-chart-template) | Distribution | `pie1`-`pie12` |
| [State](#state-diagram-template) | States | **Broken on GitHub** |
| [Mind Map](#mind-map-template) | Concepts | `cScale0`-`cScale11`, `cScaleLabel*` |
| [Timeline](#timeline-template) | History | `cScale*` |
| [Quadrant](#quadrant-chart-template) | Matrices | `quadrant*Fill` |
| [Block](#block-diagram-template) | Architecture | Inline `style` required |

---

## Flow Chart Template 1 (Simple)

```mermaid
---
config:
    theme: 'base'
    curve: 'straight'
    themeVariables:
        darkMode: true
        clusterBkg: '#22272f62'
        clusterBorder: '#6a6f77ff'
        clusterTextColor: '#6a6f77ff'
        lineColor: '#C1C4CAAA'
        background: '#262B33'
        primaryColor: '#2b4268ff'
        primaryTextColor: '#C1C4CAff'
        primaryBorderColor: '#6a6f77ff'
        primaryLabelBkg: '#262B33'
        secondaryColor: '#425f5fff'
        secondaryBorderColor: '#8c9c81ff'
        secondaryTextColor: '#C1C4CAff'
        tertiaryColor: '#4d4962ff'
        tertiaryBorderColor: '#8983a5ff'
        tertiaryTextColor: '#eeeeee55'
        nodeTextColor: '#C1C4CA'
        defaultLinkColor: '#C1C4CA'
        edgeLabelBackground: '#262B33'
        edgeLabelBorderColor: '#C1C4CA'
        labelTextColor: '#C1C4CA'
        errorBkgColor: '#724848ff'
        errorTextColor: '#C1C4CA'
        flowchart:
            curve: 'basis'
            nodeSpacing: 50
            rankSpacing: 50
            subGraphTitleMargin:
                top: 15
                bottom: 15
                left: 15
                right: 15
---
flowchart TD
    A[Component A] --> B[Component B]
    B --> C[Component C]
    C --> D[Component D]

    linkStyle default stroke:#C1C4CAaa,stroke-width:2px,color:#C1C4CAaa

    style A fill:#2b4268ff,stroke:#779DC9ff,stroke-width:2px,color:#C1C4CA,rx:8,ry:8
    style B fill:#425f5fff,stroke:#8c9c81ff,stroke-width:2px,color:#C1C4CA,rx:8,ry:8
    style C fill:#4d4962ff,stroke:#8983a5ff,stroke-width:2px,color:#C1C4CA,rx:8,ry:8
    style D fill:#7a6253ff,stroke:#c7ac9bff,stroke-width:2px,color:#C1C4CA,rx:8,ry:8
```

## Sequence Diagram Template

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        primaryColor: '#2b4268ff'
        primaryTextColor: '#FFFFFF'
        primaryBorderColor: '#779DC9'
        lineColor: '#C1C4CA'
        actorBkg: '#2b4268ff'
        actorBorder: '#779DC9'
        actorTextColor: '#C1C4CA'
        actorLineColor: '#779DC9'
        activationBorderColor: '#c7ac9bff'
        activationBkgColor: '#7a6253ff'
        sequenceNumberColor: '#FFFFFF'
        noteBkgColor: '#3a3f47ff'
        noteTextColor: '#C1C4CA'
        noteBorderColor: '#6a6f77ff'
        labelBoxBkgColor: '#425f5fff'
        labelBoxBorderColor: '#8c9c81ff'
        labelTextColor: '#C1C4CA'
        loopTextColor: '#82867eff'
        altSectionBkgColor: '#4d4962ff'
        altSectionBorderColor: '#8983a5ff'
        signalColor: '#C1C4CA'
        signalTextColor: '#C1C4CA'
        messageTextColor: '#C1C4CA'
---
sequenceDiagram
    participant A as Component A
    participant B as Component B
    participant C as Component C

    A->>+B: Initialize
    B-->>-A: Ready

    A->>+C: Process
    loop For Each Item
        C->>C: Process Item
    end
    C-->>-A: Complete

    note over A,C: Process Complete
```

## Class Diagram Template

> **Note**: Class diagrams support both `classDef` + `:::` syntax and inline `style` statements.

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        primaryColor: '#2b4268ff'
        primaryTextColor: '#C1C4CA'
        primaryBorderColor: '#3a3f47ff'
        mainBkg: '#262B33'
        secondBkg: '#425f5fff'
        textColor: '#C1C4CA'
        tertiaryBkg: '#4d4962ff'
        classText: '#C1C4CA'
        lineColor: '#978c72ff'
        labelBoxBkgColor: '#425f5fff'
        labelBoxBorderColor: '#8c9c81ff'
        labelTextColor: '#C1C4CA'
        mainContrastColor: '#FFFFFF'
        noteColor: '#7a7253ff'
        noteBkgColor: '#3a3f47ff'
        noteTextColor: '#C1C4CA'
        noteBorderColor: '#6a6f77ff'
---
classDiagram
    class InterfaceA {
        <<interface>>
        +method() String
    }

    class ClassB {
        +String attribute
        +method() String
    }

    class ClassC {
        +id: UUID
        +execute() Result
    }

    InterfaceA <|-- ClassB : inherits
    ClassB *-- ClassC : composition

    style InterfaceA fill:#2b4268ff,stroke:#779DC9ff,stroke-width:2px,color:#FFFFFF
    style ClassB fill:#425f5fff,stroke:#8c9c81ff,stroke-width:2px,color:#FFFFFF
    style ClassC fill:#4d4962ff,stroke:#8983a5ff,stroke-width:2px,color:#FFFFFF
```

## Entity Relationship Diagram Template

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        primaryColor: '#2b4268ff'
        primaryTextColor: '#FFFFFF'
        primaryBorderColor: '#779DC9'
        lineColor: '#779DC9'
        mainBkg: '#2b4268ff'
        secondBkg: '#425f5fff'
        tertiaryBkg: '#4d4962ff'
        textColor: '#C1C4CA'
        mainContrastColor: '#C1C4CA'
        relationColor: '#779DC9'
        relationLabelBackground: '#262B33'
        relationLabelColor: '#C1C4CA'
        attributeBackgroundColorOdd: '#3a3f47ff'
        attributeBackgroundColorEven: '#2f343cff'
---
erDiagram
    PARENT ||--o{ CHILD : contains
    PARENT {
        string id PK
        string name
    }
    CHILD {
        string id PK
        string parent_id FK
        string data
    }
```

## Gantt Chart Template

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        primaryTextColor: '#C1C4CA'
        primaryColor: '#2b4268ff'
        primaryBorderColor: '#779DC9'
        gridColor: '#3a3f4755'
        excludeColor: '#3a3f47ff'
        taskBkgColor: '#2b4268ff'
        taskBorderColor: '#779DC9'
        taskTextColor: '#FFFFFF'
        doneTaskBkgColor: '#425f5fff'
        doneTaskBorderColor: '#8c9c81ff'
        activeTaskBkgColor: '#7a6253ff'
        activeTaskBorderColor: '#c7ac9bff'
        critTaskBkgColor: '#724848ff'
        critTaskBorderColor: '#ac9696ff'
        milestoneBackgroundColor: '#7a7253ff'
        milestoneBorderColor: '#c7c19bff'
        sectionBkgColor: '#22272f62'
        altSectionBkgColor: '#2a2f3862'
        sectionLabelColor: '#C1C4CA'
        todayLineColor: '#c7c19bff'
        axisTextColor: '#C1C4CA'
---
gantt
    dateFormat  YYYY-MM-DD
    title       Project Timeline

    section Phase A
    Completed task            :done,    des1, 2024-01-06,2024-01-08
    Active task               :active,  des2, 2024-01-09, 3d
    Future task               :         des3, after des2, 5d

    section Milestones
    Milestone                 :milestone, 2024-01-25, 0d
```

## Pie Chart Template

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        primaryColor: '#C1C4CA'
        pie1: '#2b4268ff'
        pie2: '#425f5fff'
        pie3: '#4d4962ff'
        pie4: '#7a6253ff'
        pie5: '#724848ff'
        pie6: '#2b5f5fff'
        pieTitleTextColor: '#C1C4CA'
        pieSectionTextColor: '#e4e4e4ff'
        pieLegendTextColor: '#C1C4CA'
        pieStrokeColor: '#C1C4CA'
---
pie title Distribution
    "Category A" : 35
    "Category B" : 25
    "Category C" : 20
    "Category D" : 15
    "Category E" : 5
```

## Mind Map Template

> **Note**: Mind maps use `cScale0`-`cScale11` for node backgrounds. `primaryColor` does NOT work.

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        primaryColor: '#2b4268ff'
        primaryTextColor: '#FFFFFF'
        git0: '#2b4268ff'
        gitBranchLabel0: '#FFFFFF'
        cScale0: '#2b4268ff'
        cScale1: '#425f5fff'
        cScale2: '#4d4962ff'
        cScale3: '#7a6253ff'
        cScaleLabel0: '#FFFFFF'
        cScaleLabel1: '#FFFFFF'
        cScaleLabel2: '#FFFFFF'
        cScaleLabel3: '#FFFFFF'
---
mindmap
  root))Central Topic((
    Branch A
      Sub A1
      Sub A2
    Branch B
      Sub B1
      Sub B2
```

## Timeline Template

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        primaryColor: '#2b4268ff'
        primaryTextColor: '#C1C4CA'
        cScale0: '#2b4268ff'
        cScale1: '#425f5fff'
        cScale2: '#4d4962ff'
        titleColor: '#FFFFFF'
---
timeline
    title Project Timeline
    2024 : Planning Phase
         : Initial Research
    2025 : Development Start
         : Release
```

## Quadrant Chart Template

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        quadrant1Fill: '#425f5fff'
        quadrant2Fill: '#2b4268ff'
        quadrant3Fill: '#724848ff'
        quadrant4Fill: '#7a6253ff'
        quadrant1TextFill: '#FFFFFF'
        quadrant2TextFill: '#FFFFFF'
        quadrant3TextFill: '#FFFFFF'
        quadrant4TextFill: '#FFFFFF'
        quadrantPointFill: '#FFFFFF'
        quadrantPointTextFill: '#C1C4CA'
        quadrantXAxisTextFill: '#C1C4CA'
        quadrantYAxisTextFill: '#C1C4CA'
        quadrantTitleFill: '#FFFFFF'
---
quadrantChart
    title Priority Matrix
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Quick Wins
    quadrant-2 Major Projects
    quadrant-3 Fill Ins
    quadrant-4 Thankless Tasks

    Item A: [0.3, 0.7]
    Item B: [0.8, 0.4]
    Item C: [0.2, 0.3]
```

## Block Diagram Template

> **Note**: Block diagrams require **inline style statements** for GitHub rendering.

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        clusterBkg: '#22272f62'
        clusterBorder: '#6a6f77ff'
---
block-beta
    columns 3

    block:GroupA
        A["Component A"]
        B["Component B"]
    end

    space

    block:GroupB
        C["Component C"]
    end

    GroupA --> GroupB

    style A fill:#2b4268ff,stroke:#779DC9,stroke-width:2px,color:#C1C4CA
    style B fill:#425f5fff,stroke:#8c9c81ff,stroke-width:2px,color:#C1C4CA
    style C fill:#4d4962ff,stroke:#8983a5ff,stroke-width:2px,color:#C1C4CA
    style GroupA fill:#22272f62,stroke:#6a6f77ff,stroke-width:2px,color:#C1C4CA
    style GroupB fill:#22272f62,stroke:#6a6f77ff,stroke-width:2px,color:#C1C4CA
```

---

## Style Reference

> **See [diagram-standards.md](diagram-standards.md)** for the complete color palette, semantic color mapping, visual hierarchy guidelines, and style declaration format.
