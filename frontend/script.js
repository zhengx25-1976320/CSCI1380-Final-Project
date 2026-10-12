// eslint-disable-next-line no-unused-vars
function searchBooks(searchType) {
  const searchTerm = document.getElementById('search').value;
  //   console.log('Search term retrieved:', searchTerm);

  if (!searchTerm) {
    document.getElementById('results').innerText = 'Please enter a search term.';
    return;
  }

  console.log('Making API request', `term=${encodeURIComponent(searchTerm)}&type=${encodeURIComponent(searchType)}`);
  fetch(`/search?term=${encodeURIComponent(searchTerm)}&type=${encodeURIComponent(searchType)}`)
      .then((response) => {
        if (!response.ok) throw new Error('Search backend is unavailable');
        console.log('API request successful');
        return response.json();
      })
      .then((data) => {
        console.log('Data received from API:', data);
        displayResults(data);
      })
      .catch((error) => {
        console.error('Error during fetch operation:', error);
        document.getElementById('results').innerText = `No ${searchType} found, try another one`;
      });
}


function displayResults(data) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '';
  if (data.results && data.results.length > 0) {
    if (data.noMatch) {
      let suggestionsHtml = '<p>No exact match found, did you mean: ';
      data.results.forEach((item, index) => {
        suggestionsHtml += `<strong>${item}</strong>`;
        if (index < data.results.length - 1) {
          suggestionsHtml += ', ';
        } else {
          suggestionsHtml += '? ';
        }
        resultsDiv.innerHTML = suggestionsHtml;
      });
    } else {
      data.results.forEach((item, index) => {
        resultsDiv.innerHTML += `
          <div class="result-item">
            <div class="result-content">
            <p><strong>${index + 1}: ${item.title}</strong>, 
            written by <strong>${item.author}</strong>, in ${item.language}</p>
            </div>
            <button class="start-reading-btn" onclick="window.open('${item.url}', '_blank')">Start Reading</button>
          </div>`;
      });
    }
  } else {
    resultsDiv.innerHTML = '<p> \n No results found. Try a different search term.</p>';
  }
}
