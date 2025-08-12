import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, FileImage, AlertCircle } from 'lucide-react';
import './App.css';

const TeachableMachineImageClassifier = () => {
  const [model, setModel] = useState(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [imageResults, setImageResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  // Your Teachable Machine model URL - replace with your actual model URL
  const MODEL_URL = "https://teachablemachine.withgoogle.com/models/6UdJBojDI/";

  // Load the Teachable Machine model
  const loadModel = useCallback(async () => {
    if (model) return model;
    
    setIsModelLoading(true);
    try {
      const modelURL = MODEL_URL + "model.json";
      const metadataURL = MODEL_URL + "metadata.json";
      
      // Load the model using tmImage from the global window object
      const loadedModel = await window.tmImage.load(modelURL, metadataURL);
      setModel(loadedModel);
      return loadedModel;
    } catch (error) {
      console.error('Error loading model:', error);
      alert('Failed to load the model. Please check the model URL.');
      return null;
    } finally {
      setIsModelLoading(false);
    }
  }, [model]);

  // Process a single image through the model
  const classifyImage = async (imageElement, loadedModel) => {
    try {
      const predictions = await loadedModel.predict(imageElement);
      return predictions.map(pred => ({
        className: pred.className,
        probability: pred.probability
      }));
    } catch (error) {
      console.error('Error classifying image:', error);
      return null;
    }
  };

  // Handle file upload and processing
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setIsProcessing(true);

    try {
      // Load model if not already loaded
      const loadedModel = await loadModel();
      if (!loadedModel) {
        setIsProcessing(false);
        return;
      }

      const newResults = [];

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          // Create image element for prediction
          const img = new Image();
          const imageUrl = URL.createObjectURL(file);
          
          await new Promise((resolve) => {
            img.onload = async () => {
              const predictions = await classifyImage(img, loadedModel);
              
              if (predictions) {
                newResults.push({
                  id: Date.now() + Math.random(), // Simple unique ID
                  file: file,
                  imageUrl: imageUrl,
                  predictions: predictions.sort((a, b) => b.probability - a.probability), // Sort by highest probability
                  timestamp: new Date().toLocaleTimeString()
                });
              }
              resolve();
            };
            img.src = imageUrl;
          });
        }
      }

      // Add new results to existing results
      setImageResults(prev => [...prev, ...newResults]);
    } catch (error) {
      console.error('Error processing images:', error);
      alert('Error processing images. Please try again.');
    } finally {
      setIsProcessing(false);
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Remove an image result
  const removeImageResult = (id) => {
    setImageResults(prev => {
      const updated = prev.filter(result => result.id !== id);
      // Clean up object URLs to prevent memory leaks
      const toRemove = prev.find(result => result.id === id);
      if (toRemove) {
        URL.revokeObjectURL(toRemove.imageUrl);
      }
      return updated;
    });
  };

  // Clear all results
  const clearAllResults = () => {
    // Clean up all object URLs
    imageResults.forEach(result => URL.revokeObjectURL(result.imageUrl));
    setImageResults([]);
  };

  return (
    <div className="app-container">
      <div className="header">
        <h1 className="app-title">Teachable Machine Image Classifier</h1>
        <p className="app-description">
          Upload multiple images to classify them using your trained Teachable Machine model.
        </p>
      </div>

      {/* Upload Section */}
      <div className="upload-section">
        <div className="upload-area">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileUpload}
            className="file-input"
            disabled={isModelLoading || isProcessing}
          />
          
          <div className="upload-content">
            <Upload size={48} className="upload-icon" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isModelLoading || isProcessing}
              className="upload-button"
            >
              {isModelLoading ? 'Loading Model...' : isProcessing ? 'Processing...' : 'Upload Images'}
            </button>
            <p className="upload-text">
              Select multiple image files (JPG, PNG, etc.)
            </p>
          </div>
        </div>
      </div>

      {/* Results Header */}
      {imageResults.length > 0 && (
        <div className="results-header">
          <h2 className="results-title">
            Classification Results ({imageResults.length})
          </h2>
          <button onClick={clearAllResults} className="clear-button">
            Clear All
          </button>
        </div>
      )}

      {/* Results Grid */}
      <div className="results-grid">
        {imageResults.map((result) => (
          <div key={result.id} className="result-card">
            {/* Image */}
            <div className="image-container">
              <img
                src={result.imageUrl}
                alt={result.file.name}
                className="result-image"
              />
              <button
                onClick={() => removeImageResult(result.id)}
                className="delete-button"
              >
                <X size={16} />
              </button>
            </div>

            {/* Image Info */}
            <div className="card-content">
              <div className="file-info">
                <FileImage size={16} className="file-icon" />
                <span className="file-name" title={result.file.name}>
                  {result.file.name}
                </span>
              </div>
              
              <div className="timestamp">
                Processed at {result.timestamp}
              </div>

              {/* Predictions */}
              <div className="predictions">
                <h4 className="predictions-title">Predictions:</h4>
                {result.predictions.map((prediction, index) => (
                  <div key={index} className="prediction-item">
                    <span className="prediction-name">
                      {prediction.className}
                    </span>
                    <div className="prediction-score">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${prediction.probability * 100}%` }}
                        ></div>
                      </div>
                      <span className="probability">
                        {(prediction.probability * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {imageResults.length === 0 && !isProcessing && (
        <div className="empty-state">
          <AlertCircle size={64} className="empty-icon" />
          <h3 className="empty-title">No images uploaded yet</h3>
          <p className="empty-description">Upload some images to see classification results here.</p>
        </div>
      )}

      {/* Loading State */}
      {isProcessing && (
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">Processing images...</p>
        </div>
      )}

      {/* Instructions */}
      <div className="instructions">
        <h4 className="instructions-title">Instructions:</h4>
        <ul className="instructions-list">
          <li>• Make sure to update the MODEL_URL with your actual Teachable Machine model URL</li>
          <li>• The model will be loaded automatically when you upload your first image</li>
          <li>• You can upload multiple images at once</li>
          <li>• Each image can be removed individually using the X button</li>
          <li>• Results are sorted by confidence score (highest first)</li>
        </ul>
      </div>
    </div>
  );
};

export default TeachableMachineImageClassifier;