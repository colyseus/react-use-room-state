import "./App.css";
import Characters from "./Characters";
import Players from "./Players";

function App() {
  return (
    <>
      <h2>State</h2>
      <p>
        <strong>
          <code>.myString</code>:
        </strong>
      </p>
      <hr />

      <Characters />

      <Players />
    </>
  );
}

export default App;
