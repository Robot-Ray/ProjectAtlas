import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navigation from '../components/Navigation';
import '../confirmationPage.css';

// sample python script and JSON config for testing
const samplePythonScript = `import time

def main():
    print("Starting test run...")
    time.sleep(2)
    print("Test run completed!")`;

const sampleJsonConfig = JSON.stringify(
  {
    test_name: "Sample Test",
    duration: 120
  },
  null,
  2
);

// Display both the Python script and the JSON configuration
const DisplayCard = ({ title, content }) => (
  <div className="Display-Card">
    <div className="Card-Title">{title}</div>
    <div className="Card-Container">
      <pre><code>{content}</code></pre>
    </div>
  </div>
);

const Confirmation = ({
  pythonScript = samplePythonScript,
  jsonConfig = sampleJsonConfig,
  onConfirm,
  onReturn = "/dashboard"
}) => {
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState("");

  const handleReturn = () => {
    navigate(onReturn);
  };

  const handleConfirm = async () => {
    if (onConfirm) {
      onConfirm();
      return;
    }

    setIsLaunching(true);
    setError("");

    try {
      const response = await fetch("http://localhost:5000/api/launcher/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });

      const data = await response.json();

      if (response.status === 409) {
        navigate("/running-test");
        return;
      }

      if (!response.ok) {
        throw new Error(data.message || "Failed to start launcher.");
      }

      navigate("/running-test");
    } catch (err) {
      setError(err.message || "Failed to start launcher.");
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <>
      <Navigation />
      <div className="Confirmation-Page">
        <div className="Confirmation-Box">
          <h2 className="Title">You are about to start a new Test Run</h2>
          <p>Confirm the following before proceeding</p>

          <div className="Card-Content">
            <DisplayCard title="Script" content={pythonScript} />
            <DisplayCard title="Config" content={jsonConfig} />
          </div>

          {error && <p className="Error-Message">{error}</p>}

          <div className="Button-Group">
            <button
              className="Button Return"
              onClick={handleReturn}
              disabled={isLaunching}
            >
              Return
            </button>

            <button
              className="Button Confirm"
              onClick={handleConfirm}
              disabled={isLaunching}
            >
              {isLaunching ? "Launching..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Confirmation;