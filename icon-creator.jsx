import React from 'react';
import ReactDOM from 'react-dom';
import { Film } from 'lucide-react';

function IconCreator() {
  return (
    <div style={{
      width: '512px',
      height: '512px',
      backgroundColor: '#1a1a1a',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <Film
        color="#E50914"
        size={400}
        strokeWidth={2}
      />
    </div>
  );
}

ReactDOM.render(<IconCreator />, document.getElementById('root'));