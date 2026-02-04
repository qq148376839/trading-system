# Claude Code Agents

This directory contains specialized agents for the trading system project. Each agent is tailored to specific roles and responsibilities aligned with the project's development workflow.

## 📋 Available Agents

### 1. developer
**Purpose**: Code implementation and feature development
**Use for**:
- Implementing new features
- Fixing bugs
- Writing code following project standards
- Refactoring code

**Key Features**:
- Follows TypeScript coding standards
- Implements proper error handling with AppError
- Uses structured logging with LogService
- Ensures database operations use transactions
- Validates funds before order submission

**Usage**:
```
Launch the developer agent when you need to implement features or fix bugs
```

### 2. reviewer
**Purpose**: Code quality and security review
**Use for**:
- Code reviews
- Quality checks
- Security audits
- Architecture compliance verification

**Key Features**:
- Comprehensive checklist-based review
- Priority-based feedback (P0/P1/P2)
- Trading system specific checks
- Security and performance audits

**Usage**:
```
Launch the reviewer agent after implementing features to ensure code quality
```

### 3. tester
**Purpose**: Test case writing and quality assurance
**Use for**:
- Writing unit tests
- Creating integration tests
- Test planning and execution
- Bug reporting

**Key Features**:
- Jest-based test structure
- AAA pattern (Arrange-Act-Assert)
- Trading system specific test scenarios
- Mock and stub patterns
- Coverage requirements (>80% for core services)

**Usage**:
```
Launch the tester agent to write comprehensive test cases
```

### 4. product-manager
**Purpose**: Requirements analysis and PRD documentation
**Use for**:
- Requirement gathering
- PRD documentation
- Feature specification
- Requirements clarification

**Key Features**:
- Structured requirement gathering (5W1H)
- Standard PRD template
- Single document principle
- Chinese naming convention for features
- Must confirm before generating documents

**Usage**:
```
Launch the product-manager agent for requirement analysis and PRD creation
```

### 5. project-summarizer ⚠️ MANDATORY AGENT
**Purpose**: Documentation organization and project summary
**Use for**:
- ⚠️ **MANDATORY**: After ANY code changes or feature completion
- Summarizing conversations
- Organizing documentation
- Updating navigation files (README, CHANGELOG, etc.)
- Documentation maintenance

**Key Features**:
- Organizes docs into proper directories
- Updates CHANGELOG.md, PROJECT_STATUS.md, README.md, CODE_MAP.md
- Follows Chinese naming convention
- Avoids duplicate documentation
- Maintains documentation structure

**⚠️ CRITICAL - When to use**:
```
MUST use this agent immediately after:
- Modifying any code files (.ts/.tsx/.js/.jsx)
- Creating new features
- Fixing bugs
- Completing any development work
- Adding new API endpoints
- Changing database schema

DO NOT ask user if documentation is needed - ALWAYS generate it proactively.
```

**Usage**:
```
Automatically launch this agent after completing ANY work involving code changes.
No user permission needed - this is a mandatory step.
```

### 6. task-clarifier
**Purpose**: Clarifying vague or ambiguous requests
**Use for**:
- Understanding unclear requests
- Gathering missing information
- Helping users articulate their needs

**Key Features**:
- Structured questioning approach
- Friendly and patient tone
- Identifies missing information
- Provides common scenarios

**Usage**:
```
Automatically activated when requests are vague or ambiguous
```

## 🎯 Agent Selection Guide

### When to use which agent?

**Implementation needed?** → `developer`
- "Implement order submission feature"
- "Fix the decimal type error"
- "Add logging to strategy execution"

**Code review needed?** → `reviewer`
- "Review this code for quality issues"
- "Check if this follows our standards"
- "Audit this for security vulnerabilities"

**Tests needed?** → `tester`
- "Write tests for order service"
- "Create test cases for strategy execution"
- "Add integration tests"

**Requirements unclear?** → `product-manager`
- "I want to add a market temperature feature"
- "Need a PRD for log aggregation"
- "Help me define requirements for this feature"

**Documentation needed?** → `project-summarizer`
- "Summarize this conversation"
- "Organize these documents"
- "Update the project status"

**Request unclear?** → `task-clarifier`
- "Help me"
- "Fix this"
- "I need something"

## ⚠️ Core Principles

All agents follow these project-wide principles:

### 1. Confirm Before Acting
- **Always confirm** requirements before starting work
- **Never assume** user intent or business rules
- **List questions** in a structured format
- **Wait for answers** before proceeding

### 2. Follow Project Standards
- TypeScript coding standards
- Error handling with AppError
- Structured logging with LogService
- Transaction-based database operations
- Chinese documentation naming

### 3. Trading System Specific
- Verify funds before order submission
- Sync order status to database
- Record strategy execution summaries
- Atomic fund management operations

### 4. Documentation Management
- Single document per feature
- Update existing documents instead of creating new ones
- Use Chinese naming for features
- Keep documentation synchronized

## 📚 Project Context

These agents are aware of:
- Project architecture (layered: routes → services → utils)
- Core services (strategy-scheduler, capital-manager, basic-execution, etc.)
- Coding standards (TypeScript, naming conventions, error handling)
- Testing requirements (Jest, >80% coverage for core services)
- Trading system specifics (orders, strategies, funds management)

## 🔧 Configuration

Agents are configured via YAML front matter:
```yaml
---
name: agent-name
description: Agent purpose and use cases
model: sonnet  # or opus/haiku
---
```

## 📖 Reference Documents

Agents reference these project rules from `.cursor/rules/`:
- `common.md` - Global constraints and common standards
- `developer.md` - Development role definition
- `reviewer.md` - Code review role definition
- `tester.md` - Testing role definition
- `product-manager.md` - Product manager role definition
- `project-summarizer.md` - Documentation role definition
- `coding-standards.md` - TypeScript coding standards
- `architecture.md` - Project architecture
- `testing.md` - Testing standards
- `api-design.md` - API design standards
- `frontend.md` - Frontend standards

## 📝 Best Practices

1. **Choose the right agent** for the task
2. **Provide clear context** when launching agents
3. **Review agent output** before implementation
4. **Follow the agent's recommendations** on standards
5. **Use agents sequentially** for complex tasks:
   - product-manager → developer → tester → reviewer → project-summarizer

## 🔄 Workflow Example

```
1. User has a feature idea
   → Launch product-manager to create PRD

2. PRD approved
   → Launch developer to implement

3. Code written
   → Launch tester to write tests
   → Launch reviewer to review code

4. Everything complete
   → Launch project-summarizer to organize docs
```

## 📌 Notes

- Agents inherit project context from `.cursor/rules/`
- All agents enforce "confirm before acting" principle
- Agents use Chinese naming for documentation
- Agents maintain consistency with existing project standards
