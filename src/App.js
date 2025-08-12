import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, FileImage, AlertCircle, MapPin, Check, Trash2 } from 'lucide-react';
import './App.css';
import EXIF from 'exif-js';

const TeachableMachineImageClassifier = () => {
  const [model, setModel] = useState(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [imageResults, setImageResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [duplicatePairs, setDuplicatePairs] = useState([]);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const fileInputRef = useRef(null);

  // Backend URL from environment variable
  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

  // Your Teachable Machine model URL - replace with your actual model URL
  const MODEL_URL = "https://teachablemachine.withgoogle.com/models/6UdJBojDI/";

  // Extract GPS coordinates from EXIF data
  // Helper function to convert DMS (Degrees, Minutes, Seconds) to Decimal Degrees
  const convertDMSToDD = (dms, ref) => {
    let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (ref === "S" || ref === "W") {
      dd = dd * -1;
    }
    return dd;
  };

  const extractGPSFromExif = async (file) => {
    return new Promise((resolve) => {
      EXIF.getData(file, function () {
        const lat = EXIF.getTag(this, "GPSLatitude");
        const lon = EXIF.getTag(this, "GPSLongitude");
        const latRef = EXIF.getTag(this, "GPSLatitudeRef");
        const lonRef = EXIF.getTag(this, "GPSLongitudeRef");

        if (lat && lon && latRef && lonRef) {
          const latitude = convertDMSToDD(lat, latRef);
          const longitude = convertDMSToDD(lon, lonRef);
          resolve({ latitude, longitude });
        } else {
          resolve(null); // No GPS data available
        }
      });
    });
  };

  // Load the Teachable Machine model
  const loadModel = useCallback(async () => {
    if (model) return model;

    setIsModelLoading(true);
    try {
      const modelURL = MODEL_URL + "model.json";
      const metadataURL = MODEL_URL + "metadata.json";

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

  // Send images with location data to backend
  const sendMangoLocationsToBackend = async (allImages) => {
    // Filter only images that have location data
    const imagesWithLocation = allImages.filter(img => img.location !== null);

    if (imagesWithLocation.length === 0) {
      console.log('No images with location data to send to backend');
      return;
    }

    try {
      setIsCheckingDuplicates(true);

      const locationData = imagesWithLocation.map(img => ({
        imageName: img.file.name,
        latitude: img.location.latitude,
        longitude: img.location.longitude,
        imageId: String(img.id)
      }));

      console.log(`Sending ${locationData.length} images with location data (out of ${allImages.length} total):`, locationData);

      const response = await fetch(`${BACKEND_URL}/check-proximity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locations: locationData })
      });

      console.log('Response status:', response.status);

      if (response.ok) {
        const duplicateData = await response.json();
        console.log('Received duplicate data:', duplicateData);
        setDuplicatePairs(duplicateData.similar_pairs || []);
      } else {
        const errorText = await response.text();
        console.error('Backend error:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error checking for duplicates:', error);
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  // Handle file upload and processing
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setIsProcessing(true);

    try {
      const loadedModel = await loadModel();
      if (!loadedModel) {
        setIsProcessing(false);
        return;
      }

      const newResults = [];

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const img = new Image();
          const imageUrl = URL.createObjectURL(file);

          // Extract GPS coordinates
          const location = await extractGPSFromExif(file);

          await new Promise((resolve) => {
            img.onload = async () => {
              const predictions = await classifyImage(img, loadedModel);

              if (predictions) {
                const result = {
                  id: Date.now() + Math.random(),
                  file: file,
                  imageUrl: imageUrl,
                  predictions: predictions, // Keep original order for now, will sort in display
                  timestamp: new Date().toLocaleTimeString(),
                  location: location
                };

                newResults.push(result);
              }
              resolve();
            };
            img.src = imageUrl;
          });
        }
      }

      setImageResults(prev => [...prev, ...newResults]);

      // Send images with location data to backend
      if (newResults.length > 0) {
        await sendMangoLocationsToBackend(newResults);
      }

    } catch (error) {
      console.error('Error processing images:', error);
      alert('Error processing images. Please try again.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle duplicate resolution
  const handleDuplicateAction = async (pairId, action, imageId1, imageId2) => {
    try {
      const response = await fetch(`${BACKEND_URL}/save-decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairId: pairId,
          action: action,
          imageId1: imageId1,
          imageId2: imageId2
        })
      });

      if (response.ok) {
        // Remove the pair from duplicates list
        setDuplicatePairs(prev => prev.filter(pair => pair.pairId !== pairId));

        // Remove images from results if needed
        if (action === 'keep_first_remove_second') {
          removeImageResult(imageId2);
        } else if (action === 'remove_first_keep_second') {
          removeImageResult(imageId1);
        }
        // For 'save_both', we don't remove any images
      }
    } catch (error) {
      console.error('Error saving decision:', error);
    }
  };

  // Remove an image result
  const removeImageResult = (id) => {
    console.log('Attempting to remove image with ID:', id, typeof id);
    console.log('Current imageResults IDs:', imageResults.map(r => ({ id: r.id, type: typeof r.id })));

    setImageResults(prev => {
      const updated = prev.filter(result => String(result.id) !== String(id)); // Fixed: !== instead of ===
      const toRemove = prev.find(result => String(result.id) === String(id));
      if (toRemove) {
        URL.revokeObjectURL(toRemove.imageUrl);
        console.log('Successfully removed image:', toRemove.file.name);
      } else {
        console.log('Could not find image to remove with ID:', id);
      }
      return updated;
    });

    // Also remove from duplicate pairs if it exists
    setDuplicatePairs(prev => prev.filter(pair =>
      String(pair.imageId1) !== String(id) && String(pair.imageId2) !== String(id)
    ));
  };

  // Clear all results
  const clearAllResults = () => {
    imageResults.forEach(result => URL.revokeObjectURL(result.imageUrl));
    setImageResults([]);
    setDuplicatePairs([]);
  };

  return (
    <div className="app-container">
      <div className="header">
        <h1 className="app-title">Teachable Machine Mango Tree Classifier</h1>
        <p className="app-description">
          Upload images to classify mango trees and detect nearby duplicates using GPS location data.
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
              Select multiple image files with GPS location data (JPG, PNG, etc.)
            </p>
          </div>
        </div>
      </div>

      {/* Duplicate Pairs Section */}
      {duplicatePairs.length > 0 && (
        <div className="duplicates-section">
          <h2 className="duplicates-title">
            Nearby Mango Trees Found ({duplicatePairs.length} pairs)
            {isCheckingDuplicates && <span className="checking-text"> - Checking...</span>}
          </h2>

          {duplicatePairs.map((pair) => {
            const image1 = imageResults.find(img => String(img.id) === String(pair.imageId1));
            const image2 = imageResults.find(img => String(img.id) === String(pair.imageId2));

            if (!image1 || !image2) {
              console.log('Could not find images for pair:', pair, 'Available images:', imageResults.map(img => ({ id: img.id, name: img.file.name })));
              return null;
            }

            return (
              <div key={pair.pairId} className="duplicate-pair">
                <div className="pair-info">
                  <p className="distance-info">
                    Distance: {pair.distance ? pair.distance.toFixed(2) : 'Unknown'}m apart
                  </p>
                </div>

                <div className="pair-images">
                  <div className="pair-image">
                    <img src={image1.imageUrl} alt={image1.file.name} />
                    <p className="image-name">{image1.file.name}</p>
                    <p className="coordinates">
                      <MapPin size={14} />
                      {image1.location ? `${image1.location.latitude.toFixed(6)}, ${image1.location.longitude.toFixed(6)}` : 'No location'}
                    </p>
                  </div>

                  <div className="pair-image">
                    <img src={image2.imageUrl} alt={image2.file.name} />
                    <p className="image-name">{image2.file.name}</p>
                    <p className="coordinates">
                      <MapPin size={14} />
                      {image2.location ? `${image2.location.latitude.toFixed(6)}, ${image2.location.longitude.toFixed(6)}` : 'No location'}
                    </p>
                  </div>
                </div>

                <div className="pair-actions">
                  <button
                    className="action-btn save-both"
                    onClick={() => handleDuplicateAction(pair.pairId, 'save_both', pair.imageId1, pair.imageId2)}
                  >
                    <Check size={16} />
                    Save Both
                  </button>
                  <button
                    className="action-btn keep-first"
                    onClick={() => handleDuplicateAction(pair.pairId, 'keep_first_remove_second', pair.imageId1, pair.imageId2)}
                  >
                    <Trash2 size={16} />
                    Keep First, Remove Second
                  </button>
                  <button
                    className="action-btn keep-second"
                    onClick={() => handleDuplicateAction(pair.pairId, 'remove_first_keep_second', pair.imageId1, pair.imageId2)}
                  >
                    <Trash2 size={16} />
                    Remove First, Keep Second
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Results Header */}
      {imageResults.length > 0 && (
        <div className="results-header">
          <h2 className="results-title">
            Classification Results ({imageResults.length})
            <span className="mango-count">
              {imageResults.filter(result => {
                const mangoTreePrediction = result.predictions.find(p =>
                  p.className.toLowerCase() === 'mango_tree'
                );
                return mangoTreePrediction && mangoTreePrediction.probability > 0.5;
              }).length} mango trees detected
            </span>
          </h2>
          <button onClick={clearAllResults} className="clear-button">
            Clear All
          </button>
        </div>
      )}

      {/* Results Grid */}
      <div className="results-grid">
        {/* Sort results by timestamp (newest first) */}
        {[...imageResults]
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .map((result) => (
            <div key={result.id} className="result-card">
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

              <div className="card-content">
                <div className="file-info">
                  <FileImage size={16} className="file-icon" />
                  <span className="file-name" title={result.file.name}>
                    {result.file.name}
                  </span>
                </div>

                {result.location ? (
                  <div className="location-info">
                    <MapPin size={14} className="location-icon" />
                    <span className="coordinates">
                      {result.location.latitude.toFixed(6)}, {result.location.longitude.toFixed(6)}
                    </span>
                  </div>
                ) : (
                  <div className="location-info">
                    <MapPin size={14} className="location-icon no-location" />
                    <span className="no-location-text">No GPS data available</span>
                  </div>
                )}

                <div className="timestamp">
                  Processed at {result.timestamp}
                </div>

                <div className="predictions">
                  <h4 className="predictions-title">Predictions:</h4>
                  {/* Sort predictions: mango_tree first, then not_mango_tree, then others by probability */}
                  {result.predictions
                    .sort((a, b) => {
                      // Priority order: mango_tree, not_mango_tree, then others by probability
                      const getPriority = (pred) => {
                        if (pred.className.toLowerCase() === 'mango_tree') return 1;
                        if (pred.className.toLowerCase() === 'not_mango_tree') return 2;
                        return 3;
                      };

                      const priorityA = getPriority(a);
                      const priorityB = getPriority(b);

                      if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                      }

                      // If same priority, sort by probability (highest first)
                      return b.probability - a.probability;
                    })
                    .slice(0, 3)
                    .map((prediction, index) => (
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
          <p className="empty-description">Upload some images to see classification results and check for nearby duplicates.</p>
        </div>
      )}

      {/* Loading State */}
      {(isProcessing || isCheckingDuplicates) && (
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">
            {isProcessing ? 'Processing images...' : 'Checking for nearby duplicates...'}
          </p>
        </div>
      )}

      {/* Instructions */}
      <div className="instructions">
        <h4 className="instructions-title">Instructions:</h4>
        <ul className="instructions-list">
          <li>• Upload images with GPS location data for classification</li>
          <li>• Images will be automatically sent to the backend for proximity checking</li>
          <li>• If images are found within 1 meter of each other, you'll see duplicate resolution options</li>
          <li>• Update MODEL_URL and REACT_APP_BACKEND_URL in your environment</li>
          <li>• Each image can be removed individually using the X button</li>
        </ul>
      </div>
    </div>
  );
};

export default TeachableMachineImageClassifier;