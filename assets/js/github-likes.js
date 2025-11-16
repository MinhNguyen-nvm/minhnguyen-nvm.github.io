class GitHubLikes {
    constructor(repo, pathname) {
        this.repo = repo;
        this.pathname = pathname;
        this.issueTitle = document.title;
        this.apiUrl = `https://api.github.com/repos/${repo}`;
        this.init();
    }

    async init() {
        // Always render the like button, even if we can't connect to GitHub
        this.renderLikeButton();
        
        try {
            const issue = await this.findOrCreateIssue();
            if (issue) {
                this.issueNumber = issue.number;
                await this.loadReactions();
            }
        } catch (error) {
            // Silently handle API errors (normal for local development)
        }
    }

    async findOrCreateIssue() {
        try {
            const response = await fetch(`${this.apiUrl}/issues?state=all&labels=utterances`);
            const issues = await response.json();
            
            return issues.find(issue => 
                issue.title === this.issueTitle || 
                issue.body?.includes(this.pathname)
            );
        } catch (error) {
            console.error('Error finding issue:', error);
            return null;
        }
    }

    async loadReactions() {
        try {
            const response = await fetch(`${this.apiUrl}/issues/${this.issueNumber}/reactions`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            const reactions = await response.json();
            
            const likes = reactions.filter(reaction => reaction.content === '+1');
            this.updateLikeCount(likes.length);
            
            const userReaction = likes.find(reaction => 
                reaction.user.login === this.getCurrentUser()
            );
            this.updateLikeButton(!!userReaction);
        } catch (error) {
            console.error('Error loading reactions:', error);
        }
    }

    async toggleLike() {
        const token = this.getGitHubToken();
        if (!token) {
            this.showLoginPrompt();
            return;
        }

        try {
            const hasLiked = this.likeButton.classList.contains('liked');
            
            if (hasLiked) {
                await this.removeLike(token);
            } else {
                await this.addLike(token);
            }
            
            await this.loadReactions();
        } catch (error) {
            console.error('Error toggling like:', error);
        }
    }

    async addLike(token) {
        await fetch(`${this.apiUrl}/issues/${this.issueNumber}/reactions`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: '+1' })
        });
    }

    async removeLike(token) {
        const response = await fetch(`${this.apiUrl}/issues/${this.issueNumber}/reactions`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        const reactions = await response.json();
        
        const userLike = reactions.find(reaction => 
            reaction.content === '+1' && 
            reaction.user.login === this.getCurrentUser()
        );
        
        if (userLike) {
            await fetch(`${this.apiUrl}/issues/${this.issueNumber}/reactions/${userLike.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
        }
    }

    renderLikeButton() {
        const container = document.getElementById('github-likes-container');
        if (!container) return;

        container.innerHTML = `
            <div class="github-likes">
                <button id="like-button" class="like-btn" onclick="githubLikes.toggleLike()">
                    <svg class="heart-icon" viewBox="0 0 24 24" width="16" height="16">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                    <span class="like-count">0</span>
                </button>
            </div>
        `;
        
        this.likeButton = document.getElementById('like-button');
    }

    updateLikeCount(count) {
        const countElement = document.querySelector('.like-count');
        if (countElement) {
            countElement.textContent = count;
        }
    }

    updateLikeButton(isLiked) {
        if (this.likeButton) {
            this.likeButton.classList.toggle('liked', isLiked);
        }
    }

    getGitHubToken() {
        return localStorage.getItem('github-token');
    }

    getCurrentUser() {
        return localStorage.getItem('github-user');
    }

    showLoginPrompt() {
        const loginUrl = `https://github.com/login/oauth/authorize?client_id=YOUR_CLIENT_ID&scope=public_repo&redirect_uri=${encodeURIComponent(window.location.href)}`;
        
        if (confirm('To like this post, you need to sign in with GitHub. Would you like to sign in?')) {
            alert('GitHub OAuth setup required. For now, you can like by commenting on the GitHub issue created by Utterances below.');
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const repo = 'MinhNguyen-nvm/minhnguyen-nvm.github.io';
    const pathname = window.location.pathname;
    
    if (document.getElementById('github-likes-container')) {
        window.githubLikes = new GitHubLikes(repo, pathname);
    }
});