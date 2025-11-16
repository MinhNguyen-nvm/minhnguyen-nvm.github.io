document.addEventListener('DOMContentLoaded', function() {
    // Get current page URL
    const currentPath = window.location.pathname;
    
    // Find all sidebar links
    const sidebarLinks = document.querySelectorAll('.sidebar a');
    
    sidebarLinks.forEach(function(link) {
        // Check if link href matches current page
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('current');
        }
    });
});