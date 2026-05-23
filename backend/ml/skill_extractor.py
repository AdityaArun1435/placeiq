"""
Skill extractor — spaCy-based matching against a curated master skills list.

Usage:
    from backend.ml.skill_extractor import extract_skills_from_text, get_skills_demanded_for_role
"""

import json
import re
from pathlib import Path
from collections import Counter

# ── Master skills list ────────────────────────────────────────────────────────

MASTER_SKILLS: list[str] = [
    # Programming Languages
    "Python", "Java", "JavaScript", "TypeScript", "C", "C++", "C#",
    "Go", "Rust", "Kotlin", "Swift", "R", "MATLAB", "Scala", "Ruby", "PHP", "Dart",
    # Frontend
    "React", "Next.js", "Vue.js", "Angular", "HTML", "CSS", "Tailwind CSS",
    "Redux", "GraphQL", "WebSockets", "Webpack", "Vite", "Three.js",
    # Backend
    "Node.js", "Express.js", "FastAPI", "Django", "Flask", "Spring Boot",
    "ASP.NET", "Laravel", "Ruby on Rails", "REST API", "gRPC", "Microservices",
    "Express", "Spring",
    # Mobile
    "React Native", "Flutter", "Android", "iOS", "Expo", "SwiftUI", "Jetpack Compose",
    # Databases
    "MySQL", "PostgreSQL", "MongoDB", "Redis", "Firebase", "SQLite",
    "Cassandra", "DynamoDB", "Supabase", "Elasticsearch", "SQL",
    # Cloud & DevOps
    "AWS", "GCP", "Azure", "Docker", "Kubernetes", "CI/CD",
    "GitHub Actions", "Jenkins", "Terraform", "Linux", "Nginx", "Vercel",
    "Railway", "Ansible", "DevOps",
    # Data & AI
    "Machine Learning", "Deep Learning", "NLP", "Computer Vision",
    "TensorFlow", "PyTorch", "Scikit-learn", "Pandas", "NumPy",
    "Matplotlib", "Seaborn", "Hugging Face", "LangChain", "OpenCV", "spaCy",
    "XGBoost", "LightGBM", "Tableau", "Power BI", "PowerBI",
    "Apache Spark", "Hadoop", "Airflow", "dbt",
    "Statistics", "Data Analysis", "Data Visualization", "Big Data",
    # Security
    "Cybersecurity", "Ethical Hacking", "Penetration Testing",
    "OWASP", "Network Security", "Cryptography",
    # Concepts
    "DSA", "Data Structures", "Algorithms", "System Design", "OOP",
    "Design Patterns", "Agile", "Scrum", "Git", "Problem Solving",
    "Competitive Programming", "Operating Systems", "Computer Networks", "DBMS",
    "Networking", "Figma",
    # Trending 2024-2025
    "LLMs", "Prompt Engineering", "RAG", "Vector Databases", "Pinecone",
    "Stable Diffusion", "Web3", "Solidity", "Kafka", "WebAssembly", "Edge Computing",
    "Golang",
]

_SKILL_LOWER: dict[str, str] = {s.lower(): s for s in MASTER_SKILLS}
_MULTI_WORD = {s.lower(): s for s in MASTER_SKILLS if " " in s}

# ── Per-skill static metadata ─────────────────────────────────────────────────

SKILL_CATEGORY: dict[str, str] = {
    # Languages
    "Python": "Languages", "Java": "Languages", "JavaScript": "Languages",
    "TypeScript": "Languages", "C": "Languages", "C++": "Languages", "C#": "Languages",
    "Go": "Languages", "Golang": "Languages", "Rust": "Languages", "Kotlin": "Languages",
    "Swift": "Languages", "R": "Languages", "MATLAB": "Languages", "Scala": "Languages",
    "Ruby": "Languages", "PHP": "Languages", "Dart": "Languages", "SQL": "Databases",
    # Frontend
    "React": "Frontend", "Next.js": "Frontend", "Vue.js": "Frontend", "Angular": "Frontend",
    "HTML": "Frontend", "CSS": "Frontend", "Tailwind CSS": "Frontend", "Redux": "Frontend",
    "GraphQL": "Frontend", "WebSockets": "Frontend", "Webpack": "Frontend",
    "Vite": "Frontend", "Three.js": "Frontend", "Figma": "Frontend",
    # Backend
    "Node.js": "Backend", "Express.js": "Backend", "Express": "Backend",
    "FastAPI": "Backend", "Django": "Backend", "Flask": "Backend",
    "Spring Boot": "Backend", "Spring": "Backend", "ASP.NET": "Backend",
    "Laravel": "Backend", "Ruby on Rails": "Backend", "REST API": "Backend",
    "gRPC": "Backend", "Microservices": "Backend",
    # Mobile
    "React Native": "Mobile", "Flutter": "Mobile", "Android": "Mobile", "iOS": "Mobile",
    "Expo": "Mobile", "SwiftUI": "Mobile", "Jetpack Compose": "Mobile",
    # Databases
    "MySQL": "Databases", "PostgreSQL": "Databases", "MongoDB": "Databases",
    "Redis": "Databases", "Firebase": "Databases", "SQLite": "Databases",
    "Cassandra": "Databases", "DynamoDB": "Databases", "Supabase": "Databases",
    "Elasticsearch": "Databases",
    # Cloud & DevOps
    "AWS": "Cloud & DevOps", "GCP": "Cloud & DevOps", "Azure": "Cloud & DevOps",
    "Docker": "Cloud & DevOps", "Kubernetes": "Cloud & DevOps", "CI/CD": "Cloud & DevOps",
    "GitHub Actions": "Cloud & DevOps", "Jenkins": "Cloud & DevOps",
    "Terraform": "Cloud & DevOps", "Linux": "Cloud & DevOps", "Nginx": "Cloud & DevOps",
    "Vercel": "Cloud & DevOps", "Railway": "Cloud & DevOps", "Ansible": "Cloud & DevOps",
    "DevOps": "Cloud & DevOps",
    # Data & AI
    "Machine Learning": "Data & AI", "Deep Learning": "Data & AI", "NLP": "Data & AI",
    "Computer Vision": "Data & AI", "TensorFlow": "Data & AI", "PyTorch": "Data & AI",
    "Scikit-learn": "Data & AI", "Pandas": "Data & AI", "NumPy": "Data & AI",
    "Matplotlib": "Data & AI", "Seaborn": "Data & AI", "Hugging Face": "Data & AI",
    "LangChain": "Data & AI", "OpenCV": "Data & AI", "spaCy": "Data & AI",
    "XGBoost": "Data & AI", "LightGBM": "Data & AI", "Tableau": "Data & AI",
    "Power BI": "Data & AI", "PowerBI": "Data & AI", "Apache Spark": "Data & AI",
    "Hadoop": "Data & AI", "Airflow": "Data & AI", "dbt": "Data & AI",
    "Statistics": "Data & AI", "Data Analysis": "Data & AI",
    "Data Visualization": "Data & AI", "Big Data": "Data & AI",
    # Security
    "Cybersecurity": "Security", "Ethical Hacking": "Security",
    "Penetration Testing": "Security", "OWASP": "Security",
    "Network Security": "Security", "Cryptography": "Security",
    # Concepts
    "DSA": "Concepts", "Data Structures": "Concepts", "Algorithms": "Concepts",
    "System Design": "Concepts", "OOP": "Concepts", "Design Patterns": "Concepts",
    "Agile": "Concepts", "Scrum": "Concepts", "Git": "Concepts",
    "Problem Solving": "Concepts", "Competitive Programming": "Concepts",
    "Operating Systems": "Concepts", "Computer Networks": "Concepts",
    "DBMS": "Concepts", "Networking": "Concepts",
    # Trending
    "LLMs": "Trending 2024-25", "Prompt Engineering": "Trending 2024-25",
    "RAG": "Trending 2024-25", "Vector Databases": "Trending 2024-25",
    "Pinecone": "Trending 2024-25", "Stable Diffusion": "Trending 2024-25",
    "Web3": "Trending 2024-25", "Solidity": "Trending 2024-25",
    "Kafka": "Trending 2024-25", "WebAssembly": "Trending 2024-25",
    "Edge Computing": "Trending 2024-25",
}

SKILL_WHY: dict[str, str] = {
    "Python": "Most demanded language in Indian job listings, used across web, data, and ML roles",
    "Java": "Backbone of enterprise software and most Indian service company coding assessments",
    "JavaScript": "The only language that runs natively in browsers — non-negotiable for web roles",
    "TypeScript": "Industry standard for large codebases; strongly preferred in product companies",
    "C": "Foundational for systems programming, embedded, and competitive programming",
    "C++": "Required for competitive programming and performance-critical systems",
    "C#": "Dominant in enterprise Windows software and game development with Unity",
    "Go": "Increasingly adopted for high-performance backend services at scale",
    "Golang": "Increasingly adopted for high-performance backend services at scale",
    "Rust": "Growing demand for safe, zero-overhead systems programming",
    "Kotlin": "Modern language for Android development replacing Java",
    "Swift": "Required for iOS development at any Apple-platform company",
    "R": "Standard for statistical computing and academic data science",
    "MATLAB": "Used in signal processing and research-oriented engineering roles",
    "Scala": "Key for big data engineering with Apache Spark",
    "Ruby": "Productive scripting language, popular with Rails startups",
    "PHP": "Still powers a large part of the web; expected in web development roles",
    "Dart": "Required for Flutter cross-platform mobile development",
    "SQL": "Mandatory data retrieval skill — every tech role touches a database",
    "React": "Most in-demand frontend framework in Indian job listings since 2020",
    "Next.js": "Industry standard for production React apps with SSR and performance",
    "Vue.js": "Popular alternative to React, especially in startups and smaller teams",
    "Angular": "Dominant in large enterprise frontend projects, especially IT services",
    "HTML": "Foundational web skill — every frontend role requires solid HTML5 knowledge",
    "CSS": "Required for all frontend roles; Flexbox and Grid are must-know features",
    "Tailwind CSS": "Preferred utility-first CSS framework in modern React/Next.js projects",
    "Redux": "State management library used in large-scale React apps",
    "GraphQL": "Increasingly replacing REST APIs in product companies for flexible querying",
    "WebSockets": "Required for real-time features like chat, dashboards, and live updates",
    "Webpack": "Core bundler knowledge helps with build optimization and debugging",
    "Vite": "Modern build tool rapidly replacing Webpack in new projects",
    "Three.js": "Essential for 3D web applications and interactive visualisations",
    "Figma": "Design collaboration tool — expected for effective frontend and PM work",
    "Node.js": "Standard JavaScript runtime for backend services in full-stack roles",
    "Express.js": "Minimal Node.js framework used in virtually every JS backend project",
    "Express": "Minimal Node.js framework used in virtually every JS backend project",
    "FastAPI": "Modern Python API framework with automatic docs — growing fast in India",
    "Django": "Batteries-included Python framework dominant in Indian backend startups",
    "Flask": "Lightweight Python framework for microservices and ML model serving",
    "Spring Boot": "Standard Java framework for enterprise backend systems in India",
    "Spring": "Core Java framework underlying Spring Boot — important for senior roles",
    "ASP.NET": "Microsoft's backend framework for enterprise .NET applications",
    "Laravel": "Leading PHP framework for full-stack web applications",
    "Ruby on Rails": "Productivity-first framework popular in fast-moving startups",
    "REST API": "Building and consuming REST APIs is the core backend engineering skill",
    "gRPC": "High-performance RPC framework for inter-service communication at scale",
    "Microservices": "Architectural pattern demanded in all product company backend roles",
    "React Native": "Build iOS and Android apps from a single JavaScript codebase",
    "Flutter": "Google's cross-platform framework with native performance, growing fast in India",
    "Android": "Required for native Android app development roles",
    "iOS": "Required for native iOS app development roles at Apple-ecosystem companies",
    "Expo": "Simplifies React Native development — widely used in mobile startups",
    "SwiftUI": "Apple's declarative UI framework replacing UIKit in new iOS apps",
    "Jetpack Compose": "Google's modern declarative UI toolkit for Android development",
    "MySQL": "Most widely used relational database in Indian web applications",
    "PostgreSQL": "Preferred open-source RDBMS in product companies and modern stacks",
    "MongoDB": "Standard NoSQL database for document-based data in Node.js and Python stacks",
    "Redis": "In-memory cache and queue — separates average from strong backend engineers",
    "Firebase": "Google's real-time database popular for mobile and rapid-prototype projects",
    "SQLite": "Embedded database used in mobile apps and lightweight local storage",
    "Cassandra": "Wide-column store for high-throughput distributed data at scale",
    "DynamoDB": "AWS's managed NoSQL database used in serverless and cloud-native apps",
    "Supabase": "Open-source Firebase alternative built on PostgreSQL, growing fast",
    "Elasticsearch": "Distributed search engine used for full-text search in large products",
    "AWS": "Most demanded cloud platform in Indian job listings — covers 70% of cloud roles",
    "GCP": "Google Cloud platform with strong ML tooling and BigQuery for data roles",
    "Azure": "Microsoft's cloud dominant in enterprise and BFSI sector in India",
    "Docker": "Containerisation is now table stakes for any backend or DevOps role",
    "Kubernetes": "Container orchestration for production deployments at scale",
    "CI/CD": "Automated build-test-deploy pipelines expected in all modern engineering teams",
    "GitHub Actions": "Most popular CI/CD tool for automating workflows in GitHub-based projects",
    "Jenkins": "Enterprise-grade CI/CD server widely used in IT services and legacy stacks",
    "Terraform": "Infrastructure as Code — the standard for provisioning cloud resources",
    "Linux": "Production servers run Linux; shell proficiency is expected in backend and DevOps",
    "Nginx": "High-performance web server and reverse proxy used in production deployments",
    "Vercel": "Preferred deployment platform for Next.js and static frontend projects",
    "Railway": "Developer-friendly cloud platform for rapid backend deployments",
    "Ansible": "Configuration management and automation tool in DevOps workflows",
    "DevOps": "Bridges development and operations — a separate high-demand career track",
    "Machine Learning": "Core competency for data science and ML engineering roles",
    "Deep Learning": "Required for NLP, Computer Vision, and advanced ML engineering roles",
    "NLP": "Growing specialisation powering chatbots, search, and LLM applications",
    "Computer Vision": "In-demand specialisation for image recognition and video analytics",
    "TensorFlow": "Google's production-grade deep learning framework used at scale",
    "PyTorch": "Preferred DL framework in research and increasingly in production",
    "Scikit-learn": "Standard ML library for classification, regression, and clustering tasks",
    "Pandas": "Primary data manipulation library — no data role works without it",
    "NumPy": "Foundational for numerical computing and vectorised operations in Python",
    "Matplotlib": "Standard Python visualisation library for EDA and reporting",
    "Seaborn": "Statistical visualisation library built on Matplotlib for richer plots",
    "Hugging Face": "Hub for pre-trained transformers — essential for NLP and LLM applications",
    "LangChain": "Leading framework for building LLM-powered apps and RAG pipelines",
    "OpenCV": "Standard library for computer vision tasks and image processing",
    "spaCy": "Industrial-strength NLP library for text processing pipelines",
    "XGBoost": "Top-performing gradient boosting algorithm for structured/tabular data",
    "LightGBM": "Fast gradient boosting framework preferred in competitive ML and Kaggle",
    "Tableau": "Most demanded BI tool for data analysts in corporate roles",
    "Power BI": "Microsoft BI tool — preferred in enterprise and BFSI analytics roles",
    "PowerBI": "Microsoft BI tool — preferred in enterprise and BFSI analytics roles",
    "Apache Spark": "Standard for distributed big data processing at scale",
    "Hadoop": "Foundational distributed storage system for big data engineering roles",
    "Airflow": "Workflow orchestration tool for scheduling and monitoring data pipelines",
    "dbt": "Data transformation tool rapidly adopted in modern data stack roles",
    "Statistics": "Foundation of all data science — without it, models are black boxes",
    "Data Analysis": "Core skill for extracting business insights from raw data",
    "Data Visualization": "Presenting insights clearly is half the value a data analyst delivers",
    "Big Data": "Umbrella skill covering distributed processing of large-scale datasets",
    "Cybersecurity": "Specialisation with high demand and significant talent shortage in India",
    "Ethical Hacking": "Penetration testing skill required for red team and security consultant roles",
    "Penetration Testing": "Hands-on skill for finding vulnerabilities before malicious actors do",
    "OWASP": "Industry-standard checklist for web application security vulnerabilities",
    "Network Security": "Foundational for protecting infrastructure at every organisation",
    "Cryptography": "Underpins all secure communication, authentication, and data protection",
    "DSA": "Non-negotiable for product company interviews — asked in every FAANG-style round",
    "Data Structures": "Core foundation for efficient algorithm design and coding rounds",
    "Algorithms": "Required for coding assessment rounds at every company tier",
    "System Design": "Critical for senior and product company roles — asked at L4+ levels",
    "OOP": "Fundamental programming paradigm expected in all software development roles",
    "Design Patterns": "Demonstrates software engineering maturity beyond basic coding",
    "Agile": "All product teams work in Agile sprints — expected across tech roles",
    "Scrum": "Most common Agile methodology; scrum ceremonies are industry standard",
    "Git": "Version control is expected at every tech company — no exceptions",
    "Problem Solving": "Analytical thinking to break complex problems into solvable pieces",
    "Competitive Programming": "Sharpens algorithmic thinking for interview rounds at top companies",
    "Operating Systems": "Essential theory for understanding concurrency, memory, and processes",
    "Computer Networks": "Foundational for backend, DevOps, and security engineering roles",
    "DBMS": "Database theory — normalization, indexing, transactions — asked in interviews",
    "Networking": "Core for backend infrastructure, DevOps, and cybersecurity roles",
    "LLMs": "Transformers and large language models are reshaping every engineering role",
    "Prompt Engineering": "Critical skill for building and tuning LLM-based applications",
    "RAG": "Retrieval-Augmented Generation is the dominant pattern for enterprise AI apps",
    "Vector Databases": "Essential for semantic search and RAG pipelines in AI applications",
    "Pinecone": "Leading managed vector database for production AI and search apps",
    "Stable Diffusion": "Open-source image generation model powering the generative AI wave",
    "Web3": "Decentralised application development on blockchain networks",
    "Solidity": "Smart contract language for Ethereum and EVM-compatible blockchains",
    "Kafka": "Distributed event streaming platform for high-throughput real-time pipelines",
    "WebAssembly": "Near-native performance in browsers for compute-intensive web apps",
    "Edge Computing": "Moving compute closer to users — growing in IoT and low-latency apps",
}

SKILL_RESOURCE: dict[str, str] = {
    "Python": "https://docs.python.org/3/tutorial/",
    "Java": "https://dev.java/learn/",
    "JavaScript": "https://javascript.info/",
    "TypeScript": "https://www.typescriptlang.org/docs/handbook/",
    "C": "https://www.learn-c.org/",
    "C++": "https://www.learncpp.com/",
    "C#": "https://learn.microsoft.com/en-us/dotnet/csharp/",
    "Go": "https://go.dev/doc/tutorial/",
    "Golang": "https://go.dev/doc/tutorial/",
    "Rust": "https://doc.rust-lang.org/book/",
    "Kotlin": "https://kotlinlang.org/docs/getting-started.html",
    "Swift": "https://docs.swift.org/swift-book/",
    "R": "https://www.r-project.org/other-docs.html",
    "MATLAB": "https://www.mathworks.com/learn/tutorials/matlab-onramp.html",
    "Scala": "https://docs.scala-lang.org/tour/tour-of-scala.html",
    "Ruby": "https://www.ruby-lang.org/en/documentation/quickstart/",
    "PHP": "https://www.php.net/manual/en/getting-started.php",
    "Dart": "https://dart.dev/language",
    "SQL": "https://www.w3schools.com/sql/",
    "React": "https://react.dev",
    "Next.js": "https://nextjs.org/learn",
    "Vue.js": "https://vuejs.org/guide/introduction.html",
    "Angular": "https://angular.dev/tutorials/learn-angular",
    "HTML": "https://developer.mozilla.org/en-US/docs/Learn/HTML",
    "CSS": "https://developer.mozilla.org/en-US/docs/Learn/CSS",
    "Tailwind CSS": "https://tailwindcss.com/docs/installation",
    "Redux": "https://redux.js.org/introduction/getting-started",
    "GraphQL": "https://graphql.org/learn/",
    "WebSockets": "https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API",
    "Webpack": "https://webpack.js.org/guides/getting-started/",
    "Vite": "https://vitejs.dev/guide/",
    "Three.js": "https://threejs.org/docs/",
    "Figma": "https://www.figma.com/resources/learn-design/",
    "Node.js": "https://nodejs.org/en/docs",
    "Express.js": "https://expressjs.com/en/starter/installing.html",
    "Express": "https://expressjs.com/en/starter/installing.html",
    "FastAPI": "https://fastapi.tiangolo.com/tutorial/",
    "Django": "https://docs.djangoproject.com/en/stable/intro/tutorial01/",
    "Flask": "https://flask.palletsprojects.com/en/stable/quickstart/",
    "Spring Boot": "https://spring.io/quickstart",
    "Spring": "https://spring.io/guides",
    "ASP.NET": "https://learn.microsoft.com/en-us/aspnet/core/",
    "Laravel": "https://laravel.com/docs",
    "Ruby on Rails": "https://guides.rubyonrails.org/getting_started.html",
    "REST API": "https://restfulapi.net/",
    "gRPC": "https://grpc.io/docs/languages/",
    "Microservices": "https://microservices.io/",
    "React Native": "https://reactnative.dev/docs/getting-started",
    "Flutter": "https://docs.flutter.dev/get-started/codelab",
    "Android": "https://developer.android.com/training/basics/firstapp",
    "iOS": "https://developer.apple.com/tutorials/swiftui",
    "Expo": "https://docs.expo.dev/get-started/create-a-project/",
    "SwiftUI": "https://developer.apple.com/tutorials/swiftui",
    "Jetpack Compose": "https://developer.android.com/jetpack/compose/tutorial",
    "MySQL": "https://dev.mysql.com/doc/refman/8.0/en/tutorial.html",
    "PostgreSQL": "https://www.postgresql.org/docs/current/tutorial.html",
    "MongoDB": "https://www.mongodb.com/docs/manual/tutorial/",
    "Redis": "https://redis.io/docs/",
    "Firebase": "https://firebase.google.com/docs/guides",
    "SQLite": "https://www.sqlite.org/docs.html",
    "Cassandra": "https://cassandra.apache.org/doc/latest/",
    "DynamoDB": "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html",
    "Supabase": "https://supabase.com/docs",
    "Elasticsearch": "https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html",
    "AWS": "https://aws.amazon.com/training/",
    "GCP": "https://cloud.google.com/training",
    "Azure": "https://learn.microsoft.com/en-us/training/azure/",
    "Docker": "https://docs.docker.com/get-started/",
    "Kubernetes": "https://kubernetes.io/docs/tutorials/",
    "CI/CD": "https://www.jenkins.io/doc/tutorials/",
    "GitHub Actions": "https://docs.github.com/en/actions/quickstart",
    "Jenkins": "https://www.jenkins.io/doc/tutorials/",
    "Terraform": "https://developer.hashicorp.com/terraform/tutorials",
    "Linux": "https://www.linux.org/",
    "Nginx": "https://nginx.org/en/docs/beginners_guide.html",
    "Vercel": "https://vercel.com/docs",
    "Railway": "https://docs.railway.app/",
    "Ansible": "https://docs.ansible.com/ansible/latest/getting_started/",
    "DevOps": "https://roadmap.sh/devops",
    "Machine Learning": "https://fast.ai",
    "Deep Learning": "https://www.deeplearning.ai/",
    "NLP": "https://huggingface.co/learn/nlp-course/",
    "Computer Vision": "https://opencv.org/university/free-opencv-course/",
    "TensorFlow": "https://www.tensorflow.org/tutorials",
    "PyTorch": "https://pytorch.org/tutorials/",
    "Scikit-learn": "https://scikit-learn.org/stable/tutorial/",
    "Pandas": "https://pandas.pydata.org/docs/getting_started/",
    "NumPy": "https://numpy.org/doc/stable/user/quickstart.html",
    "Matplotlib": "https://matplotlib.org/stable/tutorials/",
    "Seaborn": "https://seaborn.pydata.org/tutorial.html",
    "Hugging Face": "https://huggingface.co/learn",
    "LangChain": "https://python.langchain.com/docs/get_started/",
    "OpenCV": "https://docs.opencv.org/4.x/d9/df8/tutorial_root.html",
    "spaCy": "https://spacy.io/usage",
    "XGBoost": "https://xgboost.readthedocs.io/en/stable/tutorials/",
    "LightGBM": "https://lightgbm.readthedocs.io/en/stable/pythonapi/lightgbm.train.html",
    "Tableau": "https://www.tableau.com/learn/training",
    "Power BI": "https://learn.microsoft.com/en-us/power-bi/",
    "PowerBI": "https://learn.microsoft.com/en-us/power-bi/",
    "Apache Spark": "https://spark.apache.org/docs/latest/quick-start.html",
    "Hadoop": "https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-common/SingleCluster.html",
    "Airflow": "https://airflow.apache.org/docs/apache-airflow/stable/tutorial/index.html",
    "dbt": "https://docs.getdbt.com/docs/introduction",
    "Statistics": "https://www.khanacademy.org/math/statistics-probability",
    "Data Analysis": "https://www.kaggle.com/learn/pandas",
    "Data Visualization": "https://matplotlib.org/stable/tutorials/",
    "Big Data": "https://spark.apache.org/docs/latest/quick-start.html",
    "Cybersecurity": "https://www.comptia.org/certifications/security",
    "Ethical Hacking": "https://www.hackthebox.com/",
    "Penetration Testing": "https://portswigger.net/web-security",
    "OWASP": "https://owasp.org/www-project-top-ten/",
    "Network Security": "https://www.coursera.org/learn/network-security",
    "Cryptography": "https://cryptohack.org/",
    "DSA": "https://leetcode.com",
    "Data Structures": "https://www.geeksforgeeks.org/data-structures/",
    "Algorithms": "https://www.geeksforgeeks.org/fundamentals-of-algorithms/",
    "System Design": "https://github.com/donnemartin/system-design-primer",
    "OOP": "https://refactoring.guru/design-patterns",
    "Design Patterns": "https://refactoring.guru/design-patterns",
    "Agile": "https://www.scrum.org/resources/scrum-guide",
    "Scrum": "https://www.scrum.org/resources/scrum-guide",
    "Git": "https://git-scm.com/book/en/v2",
    "Problem Solving": "https://leetcode.com",
    "Competitive Programming": "https://codeforces.com/",
    "Operating Systems": "https://pages.cs.wisc.edu/~remzi/OSTEP/",
    "Computer Networks": "https://www.coursera.org/learn/computer-networking",
    "DBMS": "https://www.geeksforgeeks.org/dbms/",
    "Networking": "https://www.cisco.com/c/en/us/solutions/enterprise-networks/networking-basics.html",
    "LLMs": "https://huggingface.co/learn/nlp-course/",
    "Prompt Engineering": "https://www.promptingguide.ai/",
    "RAG": "https://python.langchain.com/docs/get_started/",
    "Vector Databases": "https://www.pinecone.io/learn/vector-database/",
    "Pinecone": "https://docs.pinecone.io/guides/get-started/quickstart",
    "Stable Diffusion": "https://stable-diffusion-art.com/",
    "Web3": "https://ethereum.org/en/developers/docs/",
    "Solidity": "https://docs.soliditylang.org/en/stable/",
    "Kafka": "https://kafka.apache.org/documentation/",
    "WebAssembly": "https://webassembly.org/getting-started/developers-guide/",
    "Edge Computing": "https://www.cloudflare.com/learning/serverless/glossary/what-is-edge-computing/",
}


def _skill_resource(skill: str) -> str:
    return SKILL_RESOURCE.get(skill, "https://www.geeksforgeeks.org/")


def _skill_category(skill: str) -> str:
    return SKILL_CATEGORY.get(skill, "Concepts")


def _skill_why(skill: str, fallback: str = "") -> str:
    return SKILL_WHY.get(skill, fallback or f"In-demand skill for tech roles in 2025")


def _priority(demand_pct: float) -> str:
    if demand_pct >= 40:
        return "High"
    if demand_pct >= 20:
        return "Medium"
    return "Low"


# ── Role skill requirements ────────────────────────────────────────────────────
# Tuple format: (skill, why, time_to_learn, link, demand_pct)

_ROLE_SKILLS: dict[str, dict] = {
    "Software Engineer": {
        "must_have": [
            ("DSA", "Non-negotiable for product company interviews", "3-4 months", "https://leetcode.com", 88),
            ("Data Structures", "Core for technical interviews at all company levels", "2-3 months", "https://www.geeksforgeeks.org/data-structures/", 82),
            ("Algorithms", "Required for coding rounds at every tier", "2-3 months", "https://www.geeksforgeeks.org/fundamentals-of-algorithms/", 80),
            ("Python", "Most demanded language in Indian fresher job listings", "2-3 months", "https://docs.python.org/3/tutorial/", 78),
            ("Java", "Used in majority of service company assessments", "2-3 months", "https://dev.java/learn/", 70),
            ("SQL", "Required for database rounds in most hiring processes", "3-4 weeks", "https://www.w3schools.com/sql/", 65),
            ("OOP", "Fundamental for all software development roles", "3-4 weeks", "https://refactoring.guru/design-patterns", 62),
            ("Git", "Version control — expected in every software job", "1-2 weeks", "https://git-scm.com/book/en/v2", 60),
        ],
        "good_to_have": [
            ("System Design", "Needed for product companies; gives an edge in interviews", "3-4 months", "https://github.com/donnemartin/system-design-primer", 55),
            ("Docker", "DevOps basics — increasingly asked in interviews", "2-4 weeks", "https://docs.docker.com/get-started/", 48),
            ("REST API", "Required for backend roles; shows practical experience", "2-3 weeks", "https://restfulapi.net/", 45),
            ("Linux", "Expected for backend and DevOps roles", "2-4 weeks", "https://www.linux.org/", 42),
            ("JavaScript", "Widely used — knowing JS opens frontend opportunities too", "2-3 months", "https://javascript.info/", 40),
            ("Operating Systems", "OS concepts are asked in interviews — processes, threads, memory", "2-3 months", "https://pages.cs.wisc.edu/~remzi/OSTEP/", 38),
            ("Computer Networks", "Networking basics expected in backend engineering interviews", "1-2 months", "https://www.coursera.org/learn/computer-networking", 35),
            ("DBMS", "Database theory — normalisation, indexing — asked in interviews", "1-2 months", "https://www.geeksforgeeks.org/dbms/", 33),
            ("TypeScript", "Strongly preferred in product company frontend codebases", "1-2 months", "https://www.typescriptlang.org/docs/handbook/", 30),
            ("Design Patterns", "Demonstrates software engineering maturity beyond basic coding", "1-2 months", "https://refactoring.guru/design-patterns", 28),
            ("AWS", "Cloud basics differentiate candidates — AWS is the most demanded", "2-3 months", "https://aws.amazon.com/training/", 27),
            ("MongoDB", "NoSQL exposure expected in modern full-stack projects", "2-4 weeks", "https://www.mongodb.com/docs/manual/tutorial/", 25),
            ("Competitive Programming", "Sharpens algorithmic thinking for coding assessments", "ongoing", "https://codeforces.com/", 22),
        ],
        "improve": [
            ("Python", "Focus on time/space complexity, not just syntax", "https://realpython.com/"),
            ("SQL", "Practice joins, subqueries, window functions", "https://mode.com/sql-tutorial/"),
            ("OOP", "Practice design patterns (Singleton, Factory, Observer)", "https://refactoring.guru/design-patterns"),
        ],
    },
    "Data Scientist": {
        "must_have": [
            ("Python", "Primary language for all data science workflows", "2-3 months", "https://docs.python.org/3/tutorial/", 92),
            ("Machine Learning", "Core of the role — without it, you cannot apply", "3-4 months", "https://fast.ai", 90),
            ("SQL", "All data science roles need SQL for data extraction", "3-4 weeks", "https://www.w3schools.com/sql/", 85),
            ("Statistics", "Foundation of ML models and data interpretation", "2-3 months", "https://www.khanacademy.org/math/statistics-probability", 82),
            ("Pandas", "Primary data manipulation library — used daily in DS roles", "1-2 months", "https://pandas.pydata.org/docs/getting_started/", 80),
            ("NumPy", "Foundational for numerical computing and vectorised operations", "2-3 weeks", "https://numpy.org/doc/stable/user/quickstart.html", 75),
            ("Scikit-learn", "Standard ML library for classification, regression, clustering", "1-2 months", "https://scikit-learn.org/stable/tutorial/", 72),
            ("Data Analysis", "Every DS role requires exploratory data analysis", "1-2 months", "https://www.kaggle.com/learn/pandas", 70),
        ],
        "good_to_have": [
            ("Deep Learning", "Required for NLP/CV specialised roles", "3-4 months", "https://www.deeplearning.ai/", 55),
            ("PyTorch", "Preferred in research and ML engineering roles", "2-3 months", "https://pytorch.org/tutorials/", 50),
            ("TensorFlow", "Deep learning framework — valuable for DL specialisation", "2-3 months", "https://www.tensorflow.org/tutorials", 45),
            ("Data Visualization", "Presenting insights is half the value you deliver", "3-4 weeks", "https://matplotlib.org/stable/tutorials/", 44),
            ("Matplotlib", "Standard Python visualisation library for EDA", "2-3 weeks", "https://matplotlib.org/stable/tutorials/", 40),
            ("Tableau", "Most demanded BI tool in data analyst and scientist job listings", "2-4 weeks", "https://www.tableau.com/learn/training", 38),
            ("Feature Engineering", "Separates average DS from strong ones — core Kaggle skill", "1-2 months", "https://www.kaggle.com/learn", 36),
            ("XGBoost", "Top-performing algorithm on structured data — used in most Kaggle winners", "2-3 weeks", "https://xgboost.readthedocs.io/en/stable/", 35),
            ("NLP", "Growing specialisation powering chatbots and LLM applications", "2-3 months", "https://huggingface.co/learn/nlp-course/", 34),
            ("Git", "Version control — expected in every data science team", "1-2 weeks", "https://git-scm.com/book/en/v2", 32),
            ("Power BI", "Microsoft BI tool — preferred in BFSI and corporate DS roles", "2-3 weeks", "https://learn.microsoft.com/en-us/power-bi/", 30),
            ("Apache Spark", "Distributed data processing for big data DS roles", "2-3 months", "https://spark.apache.org/docs/latest/quick-start.html", 28),
            ("LangChain", "Framework for building LLM-powered apps — top trending skill", "1-2 months", "https://python.langchain.com/docs/get_started/", 25),
        ],
        "improve": [
            ("Python", "Focus on pandas, numpy, and matplotlib for EDA", "https://pandas.pydata.org/docs/"),
            ("Statistics", "Study hypothesis testing, distributions, Bayesian methods", "https://www.khanacademy.org/math/statistics-probability"),
            ("Machine Learning", "Build 3-5 projects on Kaggle to demonstrate skills", "https://www.kaggle.com"),
        ],
    },
    "Data Analyst": {
        "must_have": [
            ("SQL", "Primary tool for data extraction — non-negotiable for DA roles", "3-4 weeks", "https://www.w3schools.com/sql/", 95),
            ("Python", "Used for data wrangling and analysis automation", "2-3 months", "https://docs.python.org/3/tutorial/", 80),
            ("Data Analysis", "Core competency — exploratory analysis is the daily job", "1-2 months", "https://www.kaggle.com/learn/pandas", 85),
            ("Data Visualization", "Presenting insights to stakeholders is 50% of the job", "3-4 weeks", "https://matplotlib.org/stable/tutorials/", 78),
            ("Statistics", "Required for drawing correct conclusions from data", "1-2 months", "https://www.khanacademy.org/math/statistics-probability", 72),
            ("Excel", "Still widely used in corporate analytics teams for reporting", "1-2 weeks", "https://support.microsoft.com/en-us/excel", 70),
            ("Pandas", "Primary Python library for data manipulation and analysis", "1-2 months", "https://pandas.pydata.org/docs/getting_started/", 65),
        ],
        "good_to_have": [
            ("Tableau", "Most-asked BI tool in DA job listings — 60%+ of DA JDs mention it", "2-4 weeks", "https://www.tableau.com/learn/training", 60),
            ("Power BI", "Microsoft BI — preferred in BFSI and enterprise analytics roles", "2-3 weeks", "https://learn.microsoft.com/en-us/power-bi/", 55),
            ("NumPy", "Numerical computing backbone for Python data work", "2-3 weeks", "https://numpy.org/doc/stable/user/quickstart.html", 45),
            ("Matplotlib", "Standard visualisation library for EDA and custom charts", "2-3 weeks", "https://matplotlib.org/stable/tutorials/", 42),
            ("Git", "Version control — expected in data teams for script management", "1-2 weeks", "https://git-scm.com/book/en/v2", 40),
            ("Machine Learning", "Adds significant value to analyst profiles for predictive insights", "3-4 months", "https://fast.ai", 38),
            ("DBMS", "Database theory for performance tuning and schema design", "1-2 months", "https://www.geeksforgeeks.org/dbms/", 35),
            ("Scikit-learn", "For predictive analytics and ML-lite capabilities in DA roles", "1-2 months", "https://scikit-learn.org/stable/tutorial/", 32),
            ("Seaborn", "Statistical visualisation library for publication-ready plots", "1-2 weeks", "https://seaborn.pydata.org/tutorial.html", 28),
            ("Apache Spark", "For large-scale data processing beyond Pandas limitations", "2-3 months", "https://spark.apache.org/docs/latest/quick-start.html", 25),
            ("dbt", "Data transformation tool rapidly adopted in modern data stacks", "1-2 months", "https://docs.getdbt.com/docs/introduction", 22),
        ],
        "improve": [
            ("SQL", "Practice complex joins, window functions, CTEs", "https://mode.com/sql-tutorial/"),
            ("Data Visualization", "Build dashboards on public datasets", "https://www.tableau.com/public"),
            ("Statistics", "Study A/B testing and regression analysis", "https://www.khanacademy.org/math/statistics-probability"),
        ],
    },
    "Frontend Developer": {
        "must_have": [
            ("JavaScript", "Core language for frontend — no alternative exists", "2-3 months", "https://javascript.info/", 95),
            ("React", "Most demanded frontend framework in Indian job listings", "2-3 months", "https://react.dev", 90),
            ("HTML", "Fundamental — must know semantic HTML5", "2-3 weeks", "https://developer.mozilla.org/en-US/docs/Learn/HTML", 88),
            ("CSS", "Required for all frontend roles — Flexbox and Grid are must-knows", "2-4 weeks", "https://developer.mozilla.org/en-US/docs/Learn/CSS", 85),
            ("REST API", "Frontend roles require API integration knowledge", "2-3 weeks", "https://restfulapi.net/", 72),
            ("Git", "Version control — expected at every frontend job", "1-2 weeks", "https://git-scm.com/book/en/v2", 70),
            ("TypeScript", "Industry standard — most product companies require TypeScript", "1-2 months", "https://www.typescriptlang.org/docs/handbook/", 68),
        ],
        "good_to_have": [
            ("Next.js", "Industry standard for production React apps with SSR", "1-2 months", "https://nextjs.org/learn", 62),
            ("Tailwind CSS", "Preferred CSS framework in modern React/Next.js projects", "2-3 weeks", "https://tailwindcss.com/docs/installation", 55),
            ("Redux", "State management for large-scale React applications", "3-4 weeks", "https://redux.js.org/introduction/getting-started", 48),
            ("Figma", "Design collaboration tool — helps bridge frontend–design gap", "1-2 weeks", "https://www.figma.com/resources/learn-design/", 45),
            ("DSA", "Basic DSA needed even for frontend roles in product companies", "2-3 months", "https://leetcode.com", 42),
            ("GraphQL", "Increasingly replacing REST APIs in product company frontends", "3-4 weeks", "https://graphql.org/learn/", 38),
            ("Node.js", "Understanding the backend helps full-stack frontend roles", "1-2 months", "https://nodejs.org/en/docs", 35),
            ("Vite", "Modern build tool replacing Webpack in new frontend projects", "1-2 weeks", "https://vitejs.dev/guide/", 32),
            ("Testing", "Frontend testing with Jest and Testing Library is expected", "2-3 weeks", "https://jestjs.io/docs/getting-started", 30),
            ("WebSockets", "Required for real-time features — chat, live dashboards", "2-3 weeks", "https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API", 28),
            ("Vue.js", "Alternative to React — opens more job options", "1-2 months", "https://vuejs.org/guide/introduction.html", 25),
            ("Accessibility", "Web accessibility is legally required in many markets", "1-2 weeks", "https://web.dev/accessibility/", 22),
        ],
        "improve": [
            ("JavaScript", "Focus on closures, event loop, promises/async-await", "https://javascript.info/"),
            ("React", "Learn hooks, context, performance optimisation", "https://react.dev"),
            ("CSS", "Practice Flexbox, Grid, and responsive design", "https://css-tricks.com"),
        ],
    },
    "Backend Developer": {
        "must_have": [
            ("Python", "Most demanded backend language in Indian job listings", "2-3 months", "https://docs.python.org/3/tutorial/", 78),
            ("Java", "Widely used in enterprise backend — Spring Boot is standard", "2-3 months", "https://dev.java/learn/", 72),
            ("SQL", "Database knowledge is mandatory for all backend roles", "3-4 weeks", "https://www.w3schools.com/sql/", 88),
            ("REST API", "Building APIs is the core backend skill", "2-3 weeks", "https://restfulapi.net/", 85),
            ("DSA", "Required for technical interviews at every company tier", "3-4 months", "https://leetcode.com", 80),
            ("Git", "Version control — expected everywhere without exception", "1-2 weeks", "https://git-scm.com/book/en/v2", 75),
            ("OOP", "Backend design patterns and architecture principles", "3-4 weeks", "https://refactoring.guru/design-patterns", 70),
            ("Linux", "Production servers run on Linux — shell knowledge expected", "2-4 weeks", "https://www.linux.org/", 65),
        ],
        "good_to_have": [
            ("Docker", "Containerisation — increasingly required in backend roles", "2-4 weeks", "https://docs.docker.com/get-started/", 58),
            ("System Design", "Critical for product company interviews at all levels", "3-4 months", "https://github.com/donnemartin/system-design-primer", 55),
            ("MongoDB", "NoSQL is expected in modern backend and full-stack roles", "2-4 weeks", "https://www.mongodb.com/docs/manual/tutorial/", 48),
            ("Redis", "Caching layer — separates good backend engineers from average", "2-4 weeks", "https://redis.io/docs/", 45),
            ("Microservices", "Architectural pattern demanded in product company backends", "2-3 months", "https://microservices.io/", 42),
            ("PostgreSQL", "Preferred open-source RDBMS in product companies", "2-4 weeks", "https://www.postgresql.org/docs/current/tutorial.html", 40),
            ("AWS", "Cloud deployment knowledge differentiates backend candidates", "2-3 months", "https://aws.amazon.com/training/", 38),
            ("Django", "Popular Python backend framework — fast for CRUD APIs", "1-2 months", "https://docs.djangoproject.com/en/stable/intro/tutorial01/", 36),
            ("FastAPI", "Modern async Python framework growing fast in product companies", "1-2 months", "https://fastapi.tiangolo.com/tutorial/", 34),
            ("Computer Networks", "Networking basics expected in backend engineering roles", "1-2 months", "https://www.coursera.org/learn/computer-networking", 32),
            ("Kubernetes", "Container orchestration for backend at production scale", "2-3 months", "https://kubernetes.io/docs/tutorials/", 30),
            ("Kafka", "Event streaming for real-time data pipelines — growing demand", "1-2 months", "https://kafka.apache.org/documentation/", 28),
            ("DBMS", "Database theory — normalisation, indexing, transactions", "1-2 months", "https://www.geeksforgeeks.org/dbms/", 26),
        ],
        "improve": [
            ("SQL", "Practice complex queries, indexing, query optimization", "https://mode.com/sql-tutorial/"),
            ("REST API", "Build a complete CRUD API with authentication", "https://fastapi.tiangolo.com/tutorial/"),
            ("DSA", "Focus on trees, graphs, and dynamic programming", "https://leetcode.com"),
        ],
    },
    "Full Stack Developer": {
        "must_have": [
            ("JavaScript", "Full stack requires frontend + backend JS knowledge", "2-3 months", "https://javascript.info/", 92),
            ("React", "Frontend framework for full stack roles", "2-3 months", "https://react.dev", 88),
            ("Node.js", "Backend JS runtime — standard for full stack roles", "1-2 months", "https://nodejs.org/en/docs", 82),
            ("SQL", "Database knowledge required — PostgreSQL or MySQL", "3-4 weeks", "https://www.w3schools.com/sql/", 80),
            ("REST API", "Core full stack skill — building and consuming APIs", "2-3 weeks", "https://restfulapi.net/", 78),
            ("Git", "Version control — essential across all roles", "1-2 weeks", "https://git-scm.com/book/en/v2", 75),
            ("HTML", "Foundational frontend skill for full stack developers", "2-3 weeks", "https://developer.mozilla.org/en-US/docs/Learn/HTML", 72),
            ("CSS", "UI styling knowledge required for full stack roles", "2-3 weeks", "https://developer.mozilla.org/en-US/docs/Learn/CSS", 68),
        ],
        "good_to_have": [
            ("TypeScript", "Industry standard — most full stack projects use TypeScript", "1-2 months", "https://www.typescriptlang.org/docs/handbook/", 60),
            ("Next.js", "React full stack framework — widely adopted in India", "1-2 months", "https://nextjs.org/learn", 55),
            ("Docker", "Deployment knowledge differentiates full stack candidates", "2-4 weeks", "https://docs.docker.com/get-started/", 48),
            ("MongoDB", "NoSQL for document-based full stack app data", "2-4 weeks", "https://www.mongodb.com/docs/manual/tutorial/", 45),
            ("PostgreSQL", "Preferred relational DB in modern full stack stacks", "2-4 weeks", "https://www.postgresql.org/docs/current/tutorial.html", 40),
            ("Tailwind CSS", "Standard CSS utility framework in modern Next.js apps", "2-3 weeks", "https://tailwindcss.com/docs/installation", 38),
            ("DSA", "Required even for full stack roles at product companies", "2-3 months", "https://leetcode.com", 35),
            ("System Design", "Asked at full stack product company interviews", "3-4 months", "https://github.com/donnemartin/system-design-primer", 34),
            ("Redis", "Caching for performance — valued in full stack architecture", "2-4 weeks", "https://redis.io/docs/", 32),
            ("AWS", "Deployment and hosting knowledge for full stack apps", "2-3 months", "https://aws.amazon.com/training/", 30),
            ("GraphQL", "Replacing REST in product company full stack apps", "3-4 weeks", "https://graphql.org/learn/", 28),
            ("Firebase", "Real-time database popular for rapid full stack development", "2-3 weeks", "https://firebase.google.com/docs/guides", 25),
            ("Testing", "Unit and integration testing expected in full stack roles", "2-3 weeks", "https://jestjs.io/docs/getting-started", 22),
        ],
        "improve": [
            ("JavaScript", "Focus on async/await, closures, prototypes", "https://javascript.info/"),
            ("React", "Build a full project with state management", "https://react.dev"),
            ("SQL", "Practice joins, transactions, indexing", "https://www.w3schools.com/sql/"),
        ],
    },
    "DevOps Engineer": {
        "must_have": [
            ("Linux", "All production systems run Linux — non-negotiable for DevOps", "1-2 months", "https://www.linux.org/", 95),
            ("Docker", "Containerisation is core to all DevOps workflows", "1-2 months", "https://docs.docker.com/get-started/", 92),
            ("Kubernetes", "Container orchestration — expected in all DevOps interviews", "2-3 months", "https://kubernetes.io/docs/tutorials/", 85),
            ("Git", "Version control and CI/CD pipeline integration", "1-2 weeks", "https://git-scm.com/book/en/v2", 82),
            ("CI/CD", "The core DevOps practice — build, test, deploy automation", "1-2 months", "https://docs.github.com/en/actions/quickstart", 88),
            ("AWS", "Cloud platform — most demanded in Indian DevOps job listings", "2-3 months", "https://aws.amazon.com/training/", 80),
            ("Python", "Scripting and automation are daily DevOps tasks", "1-2 months", "https://docs.python.org/3/tutorial/", 70),
            ("Bash", "Shell scripting for automation in Linux environments", "1-2 months", "https://www.gnu.org/software/bash/manual/bash.html", 75),
        ],
        "good_to_have": [
            ("Terraform", "Infrastructure as Code — high value in modern DevOps roles", "1-2 months", "https://developer.hashicorp.com/terraform/tutorials", 68),
            ("Ansible", "Configuration management tool for automation at scale", "1-2 months", "https://docs.ansible.com/ansible/latest/getting_started/", 55),
            ("GitHub Actions", "Most popular CI/CD for GitHub-based projects", "2-3 weeks", "https://docs.github.com/en/actions/quickstart", 52),
            ("Prometheus", "Standard monitoring and alerting tool in Kubernetes environments", "2-4 weeks", "https://prometheus.io/docs/introduction/overview/", 48),
            ("Grafana", "Visualisation dashboards for infrastructure metrics", "2-3 weeks", "https://grafana.com/docs/grafana/latest/getting-started/", 45),
            ("GCP", "Alternative cloud platform — knowing two clouds is an advantage", "2-3 months", "https://cloud.google.com/training", 40),
            ("Azure", "Microsoft cloud dominant in enterprise DevOps roles", "2-3 months", "https://learn.microsoft.com/en-us/training/azure/", 38),
            ("Kafka", "Message queuing for distributed system and microservices pipelines", "1-2 months", "https://kafka.apache.org/documentation/", 35),
            ("Nginx", "Reverse proxy and web server used in production deployments", "1-2 weeks", "https://nginx.org/en/docs/beginners_guide.html", 32),
            ("Jenkins", "CI/CD server widely used in enterprise DevOps stacks", "1-2 months", "https://www.jenkins.io/doc/tutorials/", 30),
            ("Microservices", "Understanding the architecture DevOps supports", "1-2 months", "https://microservices.io/", 28),
            ("Network Security", "Securing infrastructure is part of the DevOps role", "2-3 months", "https://www.coursera.org/learn/network-security", 25),
        ],
        "improve": [
            ("Linux", "Practice file system, process management, networking commands", "https://www.linux.org/"),
            ("Docker", "Build and deploy multi-container apps with compose", "https://docs.docker.com/"),
            ("AWS", "Get AWS Cloud Practitioner certification", "https://aws.amazon.com/certification/"),
        ],
    },
    "ML Engineer": {
        "must_have": [
            ("Python", "Primary language for all ML engineering work", "2-3 months", "https://docs.python.org/3/tutorial/", 95),
            ("Machine Learning", "Core competency — mandatory for every ML engineer role", "3-4 months", "https://fast.ai", 92),
            ("Deep Learning", "Required for most ML engineering positions", "3-4 months", "https://www.deeplearning.ai/", 85),
            ("PyTorch", "Most widely used DL framework in production ML engineering", "2-3 months", "https://pytorch.org/tutorials/", 80),
            ("NumPy", "Core library for numerical computing and tensor operations", "2-3 weeks", "https://numpy.org/doc/stable/user/quickstart.html", 78),
            ("Pandas", "Essential for data pipelines and feature engineering", "1-2 months", "https://pandas.pydata.org/docs/getting_started/", 75),
            ("SQL", "Data pipelines require SQL for extraction and transformation", "3-4 weeks", "https://www.w3schools.com/sql/", 72),
            ("Scikit-learn", "Standard ML library for classical algorithms and pipelines", "1-2 months", "https://scikit-learn.org/stable/tutorial/", 70),
        ],
        "good_to_have": [
            ("Docker", "ML model deployment and serving uses containers", "2-4 weeks", "https://docs.docker.com/get-started/", 65),
            ("AWS", "Cloud ML deployment — SageMaker and EC2 for training", "2-3 months", "https://aws.amazon.com/sagemaker/", 60),
            ("TensorFlow", "Alternative DL framework — knowing both TF and PyTorch is valued", "2-3 months", "https://www.tensorflow.org/tutorials", 55),
            ("MLflow", "ML experiment tracking and model registry used in industry", "2-3 weeks", "https://mlflow.org/docs/latest/index.html", 52),
            ("Kubernetes", "ML at scale requires K8s for distributed training and serving", "2-3 months", "https://kubernetes.io/docs/tutorials/", 48),
            ("LangChain", "Framework for building LLM-powered apps — top trending skill", "1-2 months", "https://python.langchain.com/docs/get_started/", 45),
            ("Hugging Face", "Hub for pre-trained transformers used in NLP/CV ML engineering", "1-2 months", "https://huggingface.co/learn", 42),
            ("NLP", "Natural language processing specialisation with high demand", "2-3 months", "https://huggingface.co/learn/nlp-course/", 40),
            ("Computer Vision", "Image/video ML specialisation — OpenCV and YOLO are common", "2-3 months", "https://opencv.org/university/free-opencv-course/", 38),
            ("Kafka", "Real-time ML pipelines for event-driven model inference", "1-2 months", "https://kafka.apache.org/documentation/", 35),
            ("Git", "Version control for ML experiments and code collaboration", "1-2 weeks", "https://git-scm.com/book/en/v2", 32),
            ("RAG", "Retrieval-Augmented Generation is the dominant LLM pattern", "1-2 months", "https://python.langchain.com/docs/get_started/", 30),
            ("XGBoost", "Top algorithm for structured/tabular data competitions and production", "2-3 weeks", "https://xgboost.readthedocs.io/en/stable/", 28),
        ],
        "improve": [
            ("Machine Learning", "Build end-to-end ML projects from data to deployment", "https://www.kaggle.com"),
            ("Python", "Master vectorised operations and model optimisation", "https://numpy.org/doc/"),
            ("Deep Learning", "Study transformers, CNNs, and RNNs in depth", "https://www.deeplearning.ai/"),
        ],
    },
    "Product Manager": {
        "must_have": [
            ("SQL", "PMs use SQL daily to pull data and validate product decisions", "3-4 weeks", "https://www.w3schools.com/sql/", 82),
            ("Data Analysis", "Product decisions are data-driven — must read dashboards and metrics", "1-2 months", "https://www.kaggle.com/learn/pandas", 80),
            ("Agile", "All product teams work in Agile/Scrum — PM must lead this", "2-3 weeks", "https://www.scrum.org/resources/scrum-guide", 85),
            ("Figma", "PMs must wireframe, prototype, and collaborate with design teams", "2-3 weeks", "https://www.figma.com/resources/learn-design/", 78),
            ("Scrum", "Most common Agile methodology — PM leads sprint ceremonies", "1-2 weeks", "https://www.scrum.org/resources/scrum-guide", 75),
        ],
        "good_to_have": [
            ("Python", "Basic scripting helps PMs pull their own data and automate reports", "1-2 months", "https://docs.python.org/3/tutorial/", 45),
            ("Tableau", "BI dashboards for presenting product metrics to stakeholders", "2-4 weeks", "https://www.tableau.com/learn/training", 42),
            ("Power BI", "BI tool for corporate analytics and stakeholder reporting", "2-3 weeks", "https://learn.microsoft.com/en-us/power-bi/", 40),
            ("Machine Learning", "Understanding ML helps in AI product roles — growing requirement", "2-3 months", "https://fast.ai", 38),
            ("REST API", "Understanding API contracts helps PMs write better specs", "1-2 weeks", "https://restfulapi.net/", 35),
            ("A/B Testing", "Statistical testing for product feature validation", "2-3 weeks", "https://www.optimizely.com/optimization-glossary/ab-testing/", 55),
            ("Statistics", "Interpreting metrics, significance, and growth accurately", "1-2 months", "https://www.khanacademy.org/math/statistics-probability", 48),
            ("Google Analytics", "Product analytics for understanding user behaviour on web", "1-2 weeks", "https://analytics.google.com/", 45),
            ("OKRs", "Objectives and Key Results framework used in product companies", "1 week", "https://www.whatmatters.com/faqs/okr-meaning-definition-example", 40),
            ("Mixpanel", "Product analytics tool for mobile and SaaS products", "1-2 weeks", "https://docs.mixpanel.com/docs/what-is-mixpanel", 35),
            ("System Design", "Understanding technical architecture helps PMs scope features", "2-3 months", "https://github.com/donnemartin/system-design-primer", 32),
            ("LLMs", "AI-native PMs need to understand LLM capabilities and limitations", "1-2 months", "https://huggingface.co/learn/nlp-course/", 30),
        ],
        "improve": [
            ("SQL", "Practice product metrics queries and funnel analysis", "https://mode.com/sql-tutorial/"),
            ("Data Analysis", "Learn to set up product analytics dashboards", "https://analytics.google.com/"),
            ("Agile", "Practise writing user stories and sprint planning", "https://www.scrum.org/resources/scrum-guide"),
        ],
    },
    "Cybersecurity": {
        "must_have": [
            ("Networking", "TCP/IP, DNS, firewalls — absolute fundamentals for cybersecurity", "2-3 months", "https://www.cisco.com/c/en/us/solutions/enterprise-networks/networking-basics.html", 92),
            ("Linux", "Security tools run on Linux — must be proficient in the shell", "1-2 months", "https://www.linux.org/", 90),
            ("Python", "Scripting for security automation, exploit writing, and tooling", "2-3 months", "https://docs.python.org/3/tutorial/", 85),
            ("Operating Systems", "OS internals — understanding how vulnerabilities arise at the OS level", "2-3 months", "https://pages.cs.wisc.edu/~remzi/OSTEP/", 80),
            ("SQL", "Database attacks, SQL injection testing — core web security skill", "3-4 weeks", "https://portswigger.net/web-security/sql-injection", 75),
            ("Network Security", "Foundational for securing infrastructure and detecting intrusions", "2-3 months", "https://www.coursera.org/learn/network-security", 78),
        ],
        "good_to_have": [
            ("Cybersecurity", "Certifications like CEH, CompTIA Security+ add instant credibility", "3-4 months", "https://www.comptia.org/certifications/security", 70),
            ("Ethical Hacking", "Penetration testing skill required for red team roles", "3-4 months", "https://www.hackthebox.com/", 65),
            ("Penetration Testing", "Hands-on skill for finding vulnerabilities before attackers do", "3-4 months", "https://portswigger.net/web-security", 60),
            ("OWASP", "Industry-standard checklist for web application security", "1-2 weeks", "https://owasp.org/www-project-top-ten/", 58),
            ("AWS", "Cloud security is a growing specialty with dedicated roles", "2-3 months", "https://aws.amazon.com/security/", 50),
            ("Docker", "Container security knowledge is increasingly required", "2-4 weeks", "https://docs.docker.com/engine/security/", 45),
            ("Cryptography", "Underpins all secure communication and data protection systems", "2-3 months", "https://cryptohack.org/", 42),
            ("Git", "Version control for managing security scripts and tooling", "1-2 weeks", "https://git-scm.com/book/en/v2", 40),
            ("Bash", "Shell scripting for automation in security operations", "1-2 months", "https://www.gnu.org/software/bash/manual/bash.html", 38),
            ("Web3", "Blockchain and smart contract security — growing niche", "2-3 months", "https://ethereum.org/en/developers/docs/", 25),
        ],
        "improve": [
            ("Networking", "Set up a home lab with Wireshark and nmap", "https://www.wireshark.org/"),
            ("Linux", "Practice privilege escalation and system hardening", "https://www.linux.org/"),
            ("Python", "Write simple exploit scripts and port scanners", "https://docs.python.org/3/"),
        ],
    },
}

_DEFAULT_ROLE = "Software Engineer"


def _build_skill_item(skill: str, why: str, time_str: str, link: str, demand_pct: float) -> dict:
    """Build the unified skill item dict returned to the frontend."""
    return {
        "skill": skill,
        "demand_percentage": demand_pct,
        "why_important": why or _skill_why(skill),
        "learning_resource": link or _skill_resource(skill),
        "priority": _priority(demand_pct),
        "category": _skill_category(skill),
        "time_to_learn": time_str,
        "free_resource_link": link or _skill_resource(skill),
    }


# ── spaCy-based text extraction ───────────────────────────────────────────────

_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is not None:
        return _nlp
    try:
        import spacy
        _nlp = spacy.load("en_core_web_sm")
    except OSError:
        import subprocess, sys
        subprocess.run([sys.executable, "-m", "spacy", "download", "en_core_web_sm"], check=True)
        import spacy
        _nlp = spacy.load("en_core_web_sm")
    return _nlp


def extract_skills_from_text(text: str) -> list[str]:
    """Extract skill mentions from job posting text using spaCy + keyword matching."""
    found: list[str] = []
    text_lower = text.lower()

    for skill_lower, skill in sorted(_MULTI_WORD.items(), key=lambda x: -len(x[0])):
        if skill_lower in text_lower:
            found.append(skill)

    try:
        nlp = _get_nlp()
        doc = nlp(text[:5000])
        seen_lower = {s.lower() for s in found}
        for token in doc:
            t = token.text.lower()
            if t in _SKILL_LOWER and _SKILL_LOWER[t].lower() not in seen_lower:
                found.append(_SKILL_LOWER[t])
                seen_lower.add(t)
    except Exception:
        seen_lower = {s.lower() for s in found}
        for skill_lower, skill in _SKILL_LOWER.items():
            if " " in skill_lower:
                continue
            pattern = r"\b" + re.escape(skill_lower) + r"\b"
            if re.search(pattern, text_lower) and skill_lower not in seen_lower:
                found.append(skill)
                seen_lower.add(skill_lower)

    return found


def get_skills_demanded_for_role(target_role: str) -> dict:
    """Return skill demand data for a target role."""
    cache_path = Path(__file__).parent.parent / "market_cache.json"
    if cache_path.exists():
        try:
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            meta = data.get("meta", {})
            raw_skills = meta.get("top_skills", [])
            total_jobs = meta.get("total_jobs", 0)
            if raw_skills and total_jobs > 0:
                skills_out = [
                    {
                        "skill": s["skill"],
                        "demand_count": s["count"],
                        "demand_percentage": round(s["count"] / total_jobs * 100, 1),
                    }
                    for s in raw_skills[:20]
                ]
                return {
                    "skills": skills_out,
                    "total_roles_analysed": total_jobs,
                    "source": "Live job postings via Adzuna",
                    "role": target_role,
                }
        except Exception:
            pass

    role_key = _normalise_role(target_role)
    role_data = _ROLE_SKILLS.get(role_key, _ROLE_SKILLS[_DEFAULT_ROLE])

    all_skills = role_data["must_have"] + role_data["good_to_have"]
    skills_out = []
    for t in all_skills:
        demand_pct = t[4] if len(t) > 4 else round((len(all_skills) - len(skills_out)) / len(all_skills) * 100, 1)
        skills_out.append({
            "skill": t[0],
            "demand_count": int(demand_pct),
            "demand_percentage": demand_pct,
        })

    return {
        "skills": skills_out,
        "total_roles_analysed": 150,
        "source": "PlaceIQ curated dataset for Indian job market 2025",
        "role": target_role,
    }


def get_skill_gap_analysis(
    target_role: str,
    user_skills: list[str],
    college_tier: str = "Tier 3",
    cgpa: float = 6.0,
    branch: str = "",
) -> dict:
    """Full skill gap analysis — returns expanded skill data with categories and priorities."""
    role_key = _normalise_role(target_role)
    role_data = _ROLE_SKILLS.get(role_key, _ROLE_SKILLS[_DEFAULT_ROLE])

    user_lower = {s.lower() for s in user_skills}

    def _missing(items: list) -> list[dict]:
        result = []
        for t in items:
            skill, why, time_str, link = t[0], t[1], t[2], t[3]
            demand_pct = float(t[4]) if len(t) > 4 else 50.0
            if skill.lower() not in user_lower:
                result.append(_build_skill_item(skill, why, time_str, link, demand_pct))
        return result

    must_missing = _missing(role_data["must_have"])
    good_missing = _missing(role_data["good_to_have"])

    # Compute match percentage from role-defined skills before extending the pool
    total_required = len(role_data["must_have"]) + len(role_data["good_to_have"])
    present_count = max(0, total_required - len(must_missing) - len(good_missing))
    match_pct = round(present_count / total_required * 100, 1) if total_required else 0

    # Ensure at least 15 missing skills by pulling from a global extended pool
    combined_missing = must_missing + good_missing
    if len(combined_missing) < 15:
        extended = _get_extended_skills(role_key, user_lower, combined_missing)
        needed = 15 - len(combined_missing)
        good_missing = good_missing + extended[:needed]

    improve_items = [
        {
            "skill": t[0],
            "what_to_focus_on": t[1],
            "free_resource_link": t[2],
            "learning_resource": t[2],
            "category": _skill_category(t[0]),
        }
        for t in role_data.get("improve", [])
        if t[0].lower() in user_lower
    ]

    service_ready = cgpa >= 6.0 and len(must_missing) <= 2 and match_pct >= 40
    product_ready = cgpa >= 7.0 and len(must_missing) == 0 and match_pct >= 70

    tier_desc = {
        "Tier 1": "top-tier IIT/NIT/BITS graduate",
        "Tier 2": "Tier 2 college graduate (VIT/SRM/Manipal-level)",
        "Tier 3": "Tier 3 college graduate",
        "Tier 4": "Tier 4 college graduate",
    }.get(college_tier, "engineering graduate")

    if match_pct >= 80:
        verdict = (
            f"As a {tier_desc}, your skill profile strongly matches {target_role} requirements "
            f"({match_pct}% match). You're ready to target service companies and competitive product companies. "
            f"Focus on the {len(must_missing)} missing critical skills to unlock top-tier offers."
            if must_missing else
            f"As a {tier_desc}, your profile is well-prepared for {target_role} roles ({match_pct}% match). "
            f"Service companies will shortlist you; product companies need you to sharpen DSA and system design."
        )
    elif match_pct >= 50:
        verdict = (
            f"As a {tier_desc} with a {match_pct}% skill match for {target_role}, you can target "
            f"service companies like TCS, Infosys, and Wipro immediately. "
            f"Close {len(must_missing)} critical gaps and {len(good_missing)} good-to-have skills "
            f"to also qualify for product and startup roles."
        )
    else:
        verdict = (
            f"As a {tier_desc} with only {match_pct}% skill match for {target_role}, "
            f"you need to build your foundation first. Start with the {len(must_missing)} must-have skills "
            f"before applying anywhere. Service companies are reachable in 3-4 months with consistent effort."
        )

    demand_data = get_skills_demanded_for_role(target_role)

    return {
        "must_have_missing": must_missing,
        "good_to_have_missing": good_missing,
        "skills_to_improve": improve_items,
        "service_company_ready": service_ready,
        "product_company_ready": product_ready,
        "verdict": verdict,
        "match_percentage": match_pct,
        "total_roles_analysed": demand_data["total_roles_analysed"],
        "data_source": demand_data["source"],
    }


def _get_extended_skills(role_key: str, user_lower: set, already_included: list[dict]) -> list[dict]:
    """Return additional skills from a global pool when role pool is exhausted."""
    already_skills = {item["skill"].lower() for item in already_included}
    all_lower = user_lower | already_skills

    # Common skills valuable across all roles
    global_pool: list[tuple] = [
        ("Git", "Version control — expected at every tech company without exception", "1-2 weeks", "https://git-scm.com/book/en/v2", 60),
        ("Linux", "Production servers run Linux — shell proficiency is expected", "2-4 weeks", "https://www.linux.org/", 55),
        ("Docker", "Containerisation is now table stakes for all engineering roles", "2-4 weeks", "https://docs.docker.com/get-started/", 50),
        ("System Design", "Asked at product company interviews across all engineering roles", "3-4 months", "https://github.com/donnemartin/system-design-primer", 45),
        ("AWS", "Cloud basics differentiate candidates — most demanded cloud platform", "2-3 months", "https://aws.amazon.com/training/", 42),
        ("TypeScript", "Strongly preferred over JavaScript in product company codebases", "1-2 months", "https://www.typescriptlang.org/docs/handbook/", 40),
        ("PostgreSQL", "Preferred open-source relational database in modern stacks", "2-4 weeks", "https://www.postgresql.org/docs/current/tutorial.html", 35),
        ("Redis", "In-memory cache and queue — used in almost every production backend", "2-4 weeks", "https://redis.io/docs/", 32),
        ("Kubernetes", "Container orchestration expected in DevOps and backend at scale", "2-3 months", "https://kubernetes.io/docs/tutorials/", 30),
        ("LangChain", "Top trending framework for building LLM-powered applications", "1-2 months", "https://python.langchain.com/docs/get_started/", 28),
        ("GitHub Actions", "Most popular CI/CD automation tool for modern projects", "2-3 weeks", "https://docs.github.com/en/actions/quickstart", 26),
        ("Prompt Engineering", "Critical skill for working with and building LLM applications", "1-2 weeks", "https://www.promptingguide.ai/", 25),
        ("RAG", "Retrieval-Augmented Generation — dominant pattern for enterprise AI", "1-2 months", "https://python.langchain.com/docs/get_started/", 24),
        ("Agile", "All product teams work in Agile — understanding it is table stakes", "2-3 weeks", "https://www.scrum.org/resources/scrum-guide", 38),
        ("OOP", "Fundamental programming paradigm expected in all software roles", "3-4 weeks", "https://refactoring.guru/design-patterns", 55),
        ("DSA", "Non-negotiable for product company interviews", "3-4 months", "https://leetcode.com", 70),
        ("Competitive Programming", "Sharpens algorithmic thinking for coding assessments", "ongoing", "https://codeforces.com/", 22),
        ("DBMS", "Database theory — normalisation, indexing — asked in interviews", "1-2 months", "https://www.geeksforgeeks.org/dbms/", 30),
        ("Operating Systems", "OS concepts — processes, threads, memory — asked in interviews", "2-3 months", "https://pages.cs.wisc.edu/~remzi/OSTEP/", 28),
        ("Computer Networks", "Networking basics expected in backend and infrastructure roles", "1-2 months", "https://www.coursera.org/learn/computer-networking", 25),
    ]

    result = []
    for t in global_pool:
        if t[0].lower() not in all_lower:
            result.append(_build_skill_item(t[0], t[1], t[2], t[3], float(t[4])))
            all_lower.add(t[0].lower())

    return result


def _normalise_role(role: str) -> str:
    role_lower = role.lower().strip()
    mapping = {
        "sde": "Software Engineer",
        "software engineer": "Software Engineer",
        "software developer": "Software Engineer",
        "swe": "Software Engineer",
        "backend": "Backend Developer",
        "backend developer": "Backend Developer",
        "backend engineer": "Backend Developer",
        "frontend": "Frontend Developer",
        "frontend developer": "Frontend Developer",
        "frontend engineer": "Frontend Developer",
        "full stack": "Full Stack Developer",
        "full stack developer": "Full Stack Developer",
        "full-stack developer": "Full Stack Developer",
        "data scientist": "Data Scientist",
        "ds": "Data Scientist",
        "data analyst": "Data Analyst",
        "da": "Data Analyst",
        "business analyst": "Data Analyst",
        "ml engineer": "ML Engineer",
        "machine learning engineer": "ML Engineer",
        "ai engineer": "ML Engineer",
        "devops": "DevOps Engineer",
        "devops engineer": "DevOps Engineer",
        "site reliability engineer": "DevOps Engineer",
        "sre": "DevOps Engineer",
        "product manager": "Product Manager",
        "pm": "Product Manager",
        "apm": "Product Manager",
        "cybersecurity": "Cybersecurity",
        "security engineer": "Cybersecurity",
        "information security": "Cybersecurity",
    }
    for key, value in mapping.items():
        if key in role_lower:
            return value
    return _DEFAULT_ROLE
