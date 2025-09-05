# Contributing to CourtListener MCP Server

Thank you for your interest in contributing to the CourtListener MCP Server! We welcome contributions from the community and are grateful for your support.

## How to Contribute

### 1. Fork the Repository
- Navigate to the [CourtListener MCP repository](https://github.com/yourusername/courtlistener-mcp)
- Click the "Fork" button in the top-right corner
- Clone your fork locally:
  ```bash
  git clone https://github.com/YOUR-USERNAME/courtlistener-mcp.git
  cd courtlistener-mcp
  ```

### 2. Set Up Your Development Environment
```bash
# Install dependencies
npm install

# Set up your API key
echo 'COURTLISTENER_API_KEY="your_api_key"' > .env

# Generate court resources
npm run generate-courts

# Build the project
npm run build

# Run in development mode
npm run dev
```

### 3. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 4. Make Your Changes
- Write clean, maintainable code
- Follow the existing code style and conventions
- Add or update tests as needed
- Update documentation if you're changing functionality

### 5. Test Your Changes
```bash
# Run in development mode to test
npm run dev

# Validate resources if you've made court data changes
npm run validate-resources
```

### 6. Commit Your Changes
- Write clear, descriptive commit messages
- Use conventional commit format when possible:
  ```
  feat: Add new search functionality
  fix: Resolve issue with date parsing
  docs: Update API documentation
  ```

### 7. Push to Your Fork
```bash
git push origin feature/your-feature-name
```

### 8. Open a Pull Request
- Go to the original repository on GitHub
- Click "New Pull Request"
- Select your fork and branch
- Provide a clear description of your changes:
  - What problem does this solve?
  - What changes did you make?
  - Any breaking changes?
  - Screenshots if applicable

### 9. Code Review
- Wait for maintainers to review your PR
- Respond to any feedback or requested changes
- Once approved, your changes will be merged!

## Development Guidelines

### Code Style
- Use TypeScript for all new code
- Follow existing naming conventions
- Keep functions focused and single-purpose
- Add type definitions for all parameters and return values

### Court Data Updates
If you're updating court data:
```bash
# Update court resources
npm run update-courts

# Validate the generated resources
npm run validate-resources
```

### API Integration
- Respect CourtListener API rate limits
- Handle errors gracefully
- Cache responses when appropriate
- Follow CourtListener's API guidelines

### Documentation
- Update README.md for user-facing changes
- Add JSDoc comments for new functions
- Update type definitions as needed
- Include examples for new features

## Types of Contributions

We welcome various types of contributions:

- **Bug Fixes**: Found a bug? Submit a fix!
- **New Features**: Add new tools or enhance existing ones
- **Documentation**: Improve README, add examples, fix typos
- **Court Data**: Update court resources and mappings
- **Performance**: Optimize code for better performance
- **Testing**: Add test coverage
- **Accessibility**: Improve error messages and user experience

## Questions or Issues?

- **Bug Reports**: Open an issue with reproduction steps
- **Feature Requests**: Open an issue describing the feature
- **Questions**: Start a discussion in the Issues section
- **Security Issues**: Please email directly (do not open public issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Acknowledgments

Thank you for contributing to make legal research more accessible! Your efforts help democratize access to legal information.